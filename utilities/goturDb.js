const { Sequelize } = require("sequelize");
const PlaceFactory = require("../models/placeModel");
const FirmFactory = require("../models/firmModel");
const ApiKeyFactory = require("../models/apiKeyModel");
const UetdsPlaceFactory = require("../models/uetdsPlaceModel");
const TicketPaymentFactory = require("../models/ticketPaymentModel");
const placesSeedData = require("../seeders/placeSeeder.json");
const uetdsPlacesSeedData = require("../seeders/uetdsPlaceSeeder.json");

const GOTUR_DB_NAME = process.env.GOTUR_DB_NAME
const GOTUR_DB_USERNAME = process.env.GOTUR_DB_USERNAME
const GOTUR_DB_PASSWORD = process.env.GOTUR_DB_PASSWORD

const goturConnectionOptions = {
    host: process.env.GOTUR_DB_HOST,
    dialect: process.env.GOTUR_DB_DIALECT || "mysql",
    logging: false,
};

if (process.env.GOTUR_DB_PORT) {
    goturConnectionOptions.port = Number(process.env.GOTUR_DB_PORT);
}

if (process.env.GOTUR_DB_TIMEZONE) {
    goturConnectionOptions.timezone = process.env.GOTUR_DB_TIMEZONE;
}

const definedEntries = Object.entries(goturConnectionOptions).filter(([, value]) => value !== undefined && value !== "");
const sanitizedOptions = Object.fromEntries(definedEntries);

const goturDB = new Sequelize(
    GOTUR_DB_NAME,
    GOTUR_DB_USERNAME,
    GOTUR_DB_PASSWORD,
    sanitizedOptions
);

const goturModels = Object.freeze({
    Firm: FirmFactory(goturDB),
    Place: PlaceFactory(goturDB),
    ApiKey: ApiKeyFactory(goturDB),
    UetdsPlace: UetdsPlaceFactory(goturDB),
    TicketPayment: TicketPaymentFactory(goturDB),
});

let goturSyncPromise;

function initGoturModels() {
    return goturModels;
}

async function getGoturSyncPromise() {
    if (!goturSyncPromise) {
        // NOT: Daha önce burada `sync({})` kullanılıyordu; bu sadece eksik
        // tabloları oluşturur, VAR OLAN tablolara yeni kolon eklemez (örn.
        // TicketPayment.tenantKey). Tenant DB'lerinde zaten `alter: true`
        // kullanıldığından, ortak DB'de de aynı stratejiyle tutarlı davranmak
        // için `alter: true` kullanılıyor.
        goturSyncPromise = goturDB.sync({ alter: true })
            .then(async () => {
                const placeCount = await goturModels.Place.count();

                if (placeCount === 0 && Array.isArray(placesSeedData) && placesSeedData.length > 0) {
                    await goturModels.Place.bulkCreate(placesSeedData, { ignoreDuplicates: true });
                }

                const uetdsPlaceCount = await goturModels.UetdsPlace.count();

                if (uetdsPlaceCount === 0 && Array.isArray(uetdsPlacesSeedData) && uetdsPlacesSeedData.length > 0) {
                    await goturModels.UetdsPlace.bulkCreate(uetdsPlacesSeedData, { ignoreDuplicates: true });
                }
            })
            .catch((error) => {
                goturSyncPromise = null;
                console.error("Ortak veritabanı senkronizasyonu/başlangıç verileri yüklenirken hata oluştu:", error);
                throw error;
            });
    }

    return goturSyncPromise;
}

getGoturSyncPromise();

module.exports = { goturDB, initGoturModels, getGoturSyncPromise };
