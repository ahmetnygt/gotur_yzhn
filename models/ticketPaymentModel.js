const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("ticketPayment", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    tripId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    fromStopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    toStopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    seatNumbers: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    genders: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    isSuccess: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  });
};
