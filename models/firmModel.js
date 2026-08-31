const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Firm",
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      key: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      dbName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      displayName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        defaultValue: "active",
      },

      // 🔹 Tema renkleri (Götür varsayılan)
      primaryColor: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: "#2660ff", // Götür mavisi
      },
      accentColor: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: "#ff6b00", // Götür turuncusu
      },
      logoUrl: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "/images/default-logo.png",
      },

      // 🔹 İletişim & domain
      phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      domain: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      // 🔹 Mobil mağaza linkleri
      isGooglePlay: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      isAppStore: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      googlePlayUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      appStoreUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      // 🔹 UETDS bilgiler
      uetdsUsername: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      uetdsPassword: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      isUetdsActive: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },

      // 🔹 NetGSM SMS
      isSmsActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      smsUsername: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      smsPassword: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      smsHeader: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },

      // 🔹 Komisyon
      comissionRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 20.0,
      },

      // 🔹 Opsiyon süresi biten rezervasyonları otomatik iptal et
      // false olan firmalarda scheduler reservation → canceled yapmaz;
      // pending (geçici koltuk kilidi) temizliği her zaman devam eder.
      isReservationAutoCancelActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    }
  );
};