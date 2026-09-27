module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  return sequelize.define('Reading', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    siteCode: { type: DataTypes.STRING(50), allowNull: false, field: 'site_code' },
    pid: { type: DataTypes.STRING(100) },
    param: { type: DataTypes.STRING(50), allowNull: false },
    value: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    ts: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'readings',
    underscored: true,
    timestamps: false,
    indexes: [{ fields: ['site_code', 'ts'] }, { fields: ['pid'] }],
  });
};