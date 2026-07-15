const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define("apiKey", {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true
        },
        // GÜVENLİK DÜZELTMESİ: API key artık düz metin (`keyValue`) olarak
        // saklanmıyor; sadece HMAC-SHA256 hash'i (`keyHash`) saklanıyor, böylece
        // veritabanı sızıntısında ham key'ler ifşa olmuyor. `keyValue` geriye
        // dönük uyumluluk için tutuluyor ama artık kimlik doğrulamada
        // kullanılmıyor; mevcut kayıtlar `keyHash` ile yeniden oluşturulmalı.
        keyValue: {
            type: DataTypes.STRING,
            allowNull: true
        },
        keyHash: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        tenantKey: {
            type: DataTypes.STRING,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        }
    });
};
