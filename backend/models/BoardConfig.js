/* ============================================================
   models/BoardConfig.js — Regulatory Board Configuration (PostgreSQL)
   Stores CPCB & State Pollution Control Board (SPCB) credentials,
   RSA keys, parameters, and 24/7 cloud scheduling settings.
   ============================================================ */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BoardConfig = sequelize.define(
    'BoardConfig',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      siteCode: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: 'site_code',
      },
      boardCode: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'CPCB',
        field: 'board_code',
      },
      boardName: {
        type: DataTypes.STRING(255),
        defaultValue: 'Central Pollution Control Board',
        field: 'board_name',
      },
      apiUrl: {
        type: DataTypes.STRING(500),
        defaultValue: 'https://cems.cpcb.gov.in/v1.0/industry/data',
        field: 'api_url',
      },
      stationId: {
        type: DataTypes.STRING(100),
        defaultValue: '',
        field: 'station_id',
      },
      deviceId: {
        type: DataTypes.STRING(100),
        defaultValue: '',
        field: 'device_id',
      },
      tokenId: {
        type: DataTypes.STRING(100),
        defaultValue: '',
        field: 'token_id',
      },
      publicKeyPem: {
        type: DataTypes.TEXT,
        defaultValue: '',
        field: 'public_key_pem',
      },
      publicKeyFileName: {
        type: DataTypes.STRING(255),
        defaultValue: '',
        field: 'public_key_file_name',
      },
      payloadMode: {
        type: DataTypes.STRING(50),
        defaultValue: 'standard',
        field: 'payload_mode',
      },
      parameters: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      paramUnits: {
        type: DataTypes.JSONB,
        defaultValue: {},
        field: 'param_units',
      },
      autoPush: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: 'auto_push',
      },
      intervalMinutes: {
        type: DataTypes.INTEGER,
        defaultValue: 15,
        field: 'interval_minutes',
      },
      fallbackSimulation: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: 'fallback_simulation',
      },
      lastPushedAt: {
        type: DataTypes.DATE,
        field: 'last_pushed_at',
      },
      lastPushStatus: {
        type: DataTypes.STRING(50),
        field: 'last_push_status',
      },
      lastPushMsg: {
        type: DataTypes.TEXT,
        field: 'last_push_msg',
      },
      lastDurationMs: {
        type: DataTypes.INTEGER,
        field: 'last_duration_ms',
      },
    },
    {
      tableName: 'board_configs',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ['site_code', 'board_code'],
        },
      ],
    }
  );

  return BoardConfig;
};
