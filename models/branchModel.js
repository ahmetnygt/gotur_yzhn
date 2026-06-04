const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("branch", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    stopId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 1,
    },
    isMainBranch: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0,
    },
    mainBranchId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    ownerName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    address: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    tradeTitle: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    taxOffice: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    taxNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    f1DocumentCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    ownStopSalesCommission: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    otherStopSalesCommission: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    isPaysInternet: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    internetTicketCommission: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    defaultDeduction1: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    defaultDeduction2: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    defaultDeduction3: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    defaultDeduction4: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    defaultDeduction5: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  });
};
