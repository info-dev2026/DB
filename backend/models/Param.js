module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  return sequelize.define('Param', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    siteCode: { type: DataTypes.STRING(50), allowNull: false, field: 'site_code' },
    key: { type: DataTypes.STRING(50), allowNull: false },
    name: { type: DataTypes.STRING(150), defaultValue: null },
    pid: { type: DataTypes.STRING(100), allowNull: false },
    unit: { type: DataTypes.STRING(50), defaultValue: '' },
    limit: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    min: { type: DataTypes.DECIMAL(15, 4), defaultValue: null },
    value: { type: DataTypes.DECIMAL(15, 4), defaultValue: null },
    phVal: { type: DataTypes.DECIMAL(15, 4), defaultValue: null, field: 'ph_val' },
    signal: { type: DataTypes.STRING(20), defaultValue: 'green' },
    yToday: { type: DataTypes.INTEGER, defaultValue: 0, field: 'y_today' },
    y30: { type: DataTypes.INTEGER, defaultValue: 0, field: 'y_30' },
    y30conn: { type: DataTypes.INTEGER, defaultValue: 0, field: 'y30_conn' },
    connHrs: { type: DataTypes.INTEGER, defaultValue: 0, field: 'conn_hrs' },
    connFailHrsToday: { type: DataTypes.INTEGER, defaultValue: 0, field: 'conn_fail_hrs_today' },
    stableHrs: { type: DataTypes.INTEGER, defaultValue: 0, field: 'stable_hrs' },
    excStreak: { type: DataTypes.INTEGER, defaultValue: 0, field: 'exc_streak' },
    redCount30: { type: DataTypes.INTEGER, defaultValue: 0, field: 'red_count_30' },
    history: { type: DataTypes.JSONB, defaultValue: [] },
  }, {
    tableName: 'params',
    underscored: true,
    timestamps: true,
  });
};