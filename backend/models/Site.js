/* ============================================================
   models/Site.js — Sequelize model (PostgreSQL)
   Replaces the old Mongoose version.
   The `id` field is now an auto-increment primary key.
   The old human-readable code lives in `siteCode` (column: site_code).
   ============================================================ */

module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  const Site = sequelize.define(
    'Site',
    {
      /* ---------- Primary key ---------- */
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      /* ---------- Business key (was `id` in Mongoose) ---------- */
      siteCode: {
        type: DataTypes.STRING(50),
        unique: true,
        allowNull: false,
        field: 'site_code',          // column name in Postgres
      },

      /* ---------- Basic info ---------- */
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      sector: {
        type: DataTypes.STRING(100),
        defaultValue: '—',
      },
      loc: {
        type: DataTypes.STRING(255),
        defaultValue: '—',
      },
      lat: {
        type: DataTypes.DECIMAL(10, 6),
        defaultValue: 28.6,
      },
      lng: {
        type: DataTypes.DECIMAL(10, 6),
        defaultValue: 77.2,
      },
      spcb: {
        type: DataTypes.STRING(50),
        defaultValue: 'HSPCB',
      },
      category: {
        type: DataTypes.STRING(50),
        defaultValue: '17-Category',
      },
      stacks: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },
      etp: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },

      /* ---------- Contact ---------- */
      contact: {
        type: DataTypes.STRING(255),
        defaultValue: '—',
      },
      phone: {
        type: DataTypes.STRING(50),
        defaultValue: '—',
      },
      email: {
        type: DataTypes.STRING(255),
        defaultValue: '',
      },

      /* ---------- Flags ---------- */
      ganga: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      connectivity: {
        type: DataTypes.STRING(20),
        defaultValue: 'live',
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      running: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },

      /* ---------- Auth ---------- */
      passcode: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },

      /* ---------- Runtime state ---------- */
      lastData: {
        type: DataTypes.STRING(50),
        defaultValue: '—',
        field: 'last_data',
      },
      lastSeenAt: {
        type: DataTypes.DATE,
        defaultValue: null,
        field: 'last_seen_at',
      },
      signal: {
        type: DataTypes.STRING(20),
        defaultValue: 'green',
      },
    },
    {
      tableName: 'sites',
      underscored: true,             // maps camelCase fields → snake_case columns
      timestamps: true,              // auto-adds created_at, updated_at
    }
  );

  return Site;
};