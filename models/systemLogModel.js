const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("systemLog", {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    branchId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    module: {
      type: DataTypes.ENUM("transaction", "ticket", "auth", "report", "user"),
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    referenceId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    oldData: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    newData: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  });
};
