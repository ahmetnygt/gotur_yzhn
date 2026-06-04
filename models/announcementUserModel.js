const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "announcementuser",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      announcementId: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      userId: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      seenAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["announcementId", "userId"],
        },
      ],
    }
  );
};
