const { Op } = require('sequelize');
const {
  getTenantConnection,
  getActiveTenantKeys,
} = require('../utilities/database');

function readConfiguredTenantKeys() {
  const configured = [];

  if (process.env.RESERVATION_JOB_TENANT_KEY) {
    configured.push(process.env.RESERVATION_JOB_TENANT_KEY);
  }

  if (process.env.RESERVATION_JOB_TENANT_KEYS) {
    configured.push(...process.env.RESERVATION_JOB_TENANT_KEYS.split(','));
  }

  return configured
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveTenantKeysForJob() {
  const keys = new Set([
    ...readConfiguredTenantKeys(),
    ...getActiveTenantKeys(),
  ]);

  return Array.from(keys);
}

// Try to use node-cron; fall back to setInterval if unavailable
let cron;
try {
  cron = require('node-cron');
} catch (err) {
  console.warn('node-cron not installed, using setInterval fallback');
}

function buildExpirationDate(optionDate, optionTime, fallbackDateParts) {
  if (!optionDate && !optionTime) {
    return null;
  }

  let year;
  let month;
  let day;

  if (optionDate) {
    const [y, m, d] = String(optionDate)
      .split('-')
      .map((value) => Number(value));

    if ([y, m, d].some((value) => Number.isNaN(value))) {
      return null;
    }

    year = y;
    month = m;
    day = d;
  } else if (fallbackDateParts) {
    [year, month, day] = fallbackDateParts;
  } else {
    return null;
  }

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (optionTime instanceof Date) {
    hours = optionTime.getHours();
    minutes = optionTime.getMinutes();
    seconds = optionTime.getSeconds();
  } else if (optionTime) {
    const normalized = String(optionTime).split('.')[0];
    const [h = '0', m = '0', s = '0'] = normalized.split(':');
    hours = Number(h) || 0;
    minutes = Number(m) || 0;
    seconds = Number(s) || 0;
  }

  const expiration = new Date(year, month - 1, day, hours, minutes, seconds);
  return Number.isNaN(expiration.getTime()) ? null : expiration;
}

async function cancelExpiredReservationsForTenant(tenantKey, now, fallbackDateParts) {
  const tenant = await getTenantConnection(tenantKey);
  const { models, sequelize } = tenant;
  const { Ticket, SystemLog } = models;

  if (!Ticket || !SystemLog) {
    console.error(
      `[${tenantKey}] Reservation cleanup job: Ticket veya SystemLog modeli bulunamadı.`
    );
    return;
  }

  // Tek sorgu ile al, sonra ayır
  const candidateTickets = await Ticket.findAll({
    where: {
      status: { [Op.in]: ['reservation', 'pending'] },
    },
    attributes: ['id', 'status', 'optionDate', 'optionTime'],
    raw: true,
  });
  console.log(`[${tenantKey}] İptal edilesi biletler sorgulandı.`);

  const expiredTickets = candidateTickets.filter((ticket) => {
    const expiresAt = buildExpirationDate(
      ticket.optionDate,
      ticket.optionTime,
      fallbackDateParts
    );

    return expiresAt && expiresAt <= now;
  });

  if (expiredTickets.length === 0) {
    console.log(`[${tenantKey}] İptal edilesi bilet bulunamadı.`);
    return;
  }

  const reservationIds = expiredTickets
    .filter((ticket) => ticket.status === 'reservation')
    .map((ticket) => ticket.id);
  const pendingIds = expiredTickets
    .filter((ticket) => ticket.status === 'pending')
    .map((ticket) => ticket.id);

  // İşlemleri atomik yapmak için transaction
  await sequelize.transaction(async (tx) => {
    // 1) reservation → canceled
    if (reservationIds.length) {
      await Ticket.update(
        { status: 'canceled' }, // modelde 'canceled' kullanıyoruz
        { where: { id: { [Op.in]: reservationIds } }, transaction: tx }
      );

      await SystemLog.bulkCreate(
        reservationIds.map((id) => ({
          userId: null,
          branchId: null,
          module: 'ticket',
          action: 'auto_cancel',
          referenceId: id,
          newData: { status: 'canceled' }, // log da aynı
          description: 'Reservation automatically canceled by scheduler',
        })),
        { transaction: tx }
      );
    }

    // 2) pending → destroy
    if (pendingIds.length) {
      await Ticket.destroy({
        where: { id: { [Op.in]: pendingIds } },
        transaction: tx,
      });

      await SystemLog.bulkCreate(
        pendingIds.map((id) => ({
          userId: null,
          branchId: null,
          module: 'ticket',
          action: 'auto_delete',
          referenceId: id,
          newData: { deleted: true },
          description: 'Pending ticket automatically deleted by scheduler',
        })),
        { transaction: tx }
      );
    }
  });

  if (reservationIds.length) {
    console.log(
      `[Scheduler][${tenantKey}] Reservations canceled: ${reservationIds.join(', ')}`
    );
  }
  if (pendingIds.length) {
    console.log(
      `[Scheduler][${tenantKey}] Pending tickets deleted: ${pendingIds.join(', ')}`
    );
  }
}

// Task that cancels expired reservations and deletes expired pendings
async function cancelExpiredReservations() {
  const now = new Date();
  const fallbackDateParts = [
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
  ];

  const tenantKeys = resolveTenantKeysForJob();

  if (tenantKeys.length === 0) {
    console.warn(
      'Reservation cleanup job çalıştırılmadı: aktif veya yapılandırılmış tenant anahtarı yok.'
    );
    return;
  }

  for (const tenantKey of tenantKeys) {
    try {
      await cancelExpiredReservationsForTenant(tenantKey, now, fallbackDateParts);
    } catch (err) {
      console.error(
        `Tenant ${tenantKey} için rezervasyon temizleme hatası:`,
        err
      );
    }
  }
}

let jobInstance;
function start() {
  if (cron) {
    // Her dakika çalışır
    jobInstance = cron.schedule('* * * * *', cancelExpiredReservations);
  } else {
    jobInstance = setInterval(cancelExpiredReservations, 60 * 1000);
  }
  console.log("Reservation Cleanup Job Started.")
}

function stop() {
  if (cron && jobInstance) {
    jobInstance.stop();
  } else if (jobInstance) {
    clearInterval(jobInstance);
  }
}

module.exports = { start, stop };
