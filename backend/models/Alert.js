module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  return sequelize.define('Alert', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    siteCode: { type: DataTypes.STRING(50), allowNull: false, field: 'site_code' },
    siteName: { type: DataTypes.STRING(255), allowNull: false, field: 'site_name' },
    param: { type: DataTypes.STRING(50), allowNull: false },
    level: {
      type: DataTypes.ENUM('green', 'yellow', 'orange', 'red', 'purple', 'grey', 'delay'),
      allowNull: false,
    },
    reason: { type: DataTypes.TEXT, defaultValue: '' },
    acknowledged: { type: DataTypes.BOOLEAN, defaultValue: false },
    ackBy: { type: DataTypes.STRING(100), defaultValue: null, field: 'ack_by' },
    ackAt: { type: DataTypes.DATE, defaultValue: null, field: 'ack_at' },
    emailed: { type: DataTypes.BOOLEAN, defaultValue: false },
    ts: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'alerts',
    underscored: true,
    timestamps: false,
    indexes: [{ fields: ['site_code', 'ts'] }],
  });
};