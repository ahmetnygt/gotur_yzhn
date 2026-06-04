const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("ticket", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    tripId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    goturUserId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    ticketGroupId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    customerId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    seatNo: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    price: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(
        "web",
        "gotur",
        "completed",
        "reservation",
        "canceled",
        "refund",
        "open",
        "pending"
      ),
      allowNull: false,
    },
    idNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    surname: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    gender: {
      type: DataTypes.ENUM("m", "f"),
      allowNull: false,
    },
    nationality: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    customerType: {
      type: DataTypes.ENUM("adult", "child", "student", "disabled", "retired"),
      allowNull: true,
    },
    customerCategory: {
      type: DataTypes.ENUM("normal", "member", "guest"),
      allowNull: true,
    },
    optionTime: {
      type: DataTypes.TIME,
    },
    optionDate: {
      type: DataTypes.DATEONLY,
    },
    fromRouteStopId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    toRouteStopId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    takeOnText: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    takeOffText: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    pnr: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    uetdsRefNo: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    payment: {
      type: DataTypes.ENUM("cash", "card", "point"),
      allowNull: true,
    },
  });
};
