const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define("apiKey", {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true
        },
        keyValue: {
            type: DataTypes.STRING,
            allowNull: false
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
