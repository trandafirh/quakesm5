'use strict';
const { ethers } = require('ethers');

const HUB_ABI = [
  'function submit(bytes32 feedId, int256[] values, bytes[] signatures)',
  'function getFeed(bytes32 feedId) view returns (tuple(bool exists, bool locked, uint8 decimals, uint8 quorum, uint32 minInterval, uint80 latestRound, uint64 lastUpdate, uint256 maxStep, string description))',
  'function latestRoundData(bytes32 feedId) view returns (uint80 roundId, int256 answer, uint256 updatedAt)',
  'function isOperator(bytes32 feedId, address operator) view returns (bool)',
  'function operatorCount(bytes32 feedId) view returns (uint256)',
  'function hashReport(bytes32 feedId, uint80 roundId, int256 value) view returns (bytes32)',
  'function applyOperator(bytes32 feedId, string url)',
  'function setMyUrl(bytes32 feedId, string url)',
  'function approveOperators(bytes32 feedId, address[] ops)',
  'function rejectApplicants(bytes32 feedId, address[] ops)',
  'function getOperators(bytes32 feedId) view returns (address[] addrs, string[] urls)',
  'function getPending(bytes32 feedId) view returns (address[] addrs, string[] urls)',
  'function operatorUrl(bytes32 feedId, address operator) view returns (string)',
  'function pendingUrl(bytes32 feedId, address applicant) view returns (string)'
];

/** Hub V2 (OpsikomV2): le firme coprono anche observedAt, il momento della misura. */
const HUB_ABI_V2 = [
  'function submit(bytes32 feedId, int256[] values, uint64 observedAt, bytes[] signatures)',
  'function getFeed(bytes32 feedId) view returns (tuple(bool exists, bool locked, uint8 decimals, uint8 quorum, uint32 minInterval, uint80 latestRound, uint64 lastPublishedAt, uint256 maxStep, uint256 maxObservationAge, uint256 maxFutureSkew, string description))',
  'function latestRoundData(bytes32 feedId) view returns (uint80 roundId, int256 answer, uint256 observedAt, uint256 publishedAt)',
  ...HUB_ABI.filter((f) => !/function (submit|getFeed|latestRoundData|hashReport)\(/.test(f))
];

/** Versione dell'hub da una variabile d'ambiente ('1' di default). */
function hubVersion(v) {
  const n = Number(v || 1);
  if (n !== 1 && n !== 2) throw new Error('versione hub non valida: ' + v);
  return n;
}

/** Momento dell'osservazione di un feed per gli hub V2: quello dichiarato dal feed, altrimenti la mezzanotte UTC di oggi. */
function observedAtOf(mod, now = new Date()) {
  if (mod && typeof mod.observedAt === 'function') return mod.observedAt(now);
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
}

function typedDataV2(chainId, hub, feedId, roundId, value, observedAt) {
  return {
    domain: { name: 'Opsikom', version: '2', chainId, verifyingContract: hub },
    types: {
      Report: [
        { name: 'feedId', type: 'bytes32' },
        { name: 'roundId', type: 'uint80' },
        { name: 'value', type: 'int256' },
        { name: 'observedAt', type: 'uint64' }
      ]
    },
    message: { feedId, roundId, value, observedAt }
  };
}

/** L'ID di un feed e' l'hash del suo nome: feedIdOf('TEMP') */
function feedIdOf(name) {
  return ethers.id(name);
}

function typedData(chainId, hub, feedId, roundId, value) {
  return {
    domain: { name: 'Opsikom', version: '1', chainId, verifyingContract: hub },
    types: {
      Report: [
        { name: 'feedId', type: 'bytes32' },
        { name: 'roundId', type: 'uint80' },
        { name: 'value', type: 'int256' }
      ]
    },
    message: { feedId, roundId, value }
  };
}

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error('Variabile mancante: ' + name);
  return v;
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

module.exports = { HUB_ABI, HUB_ABI_V2, hubVersion, observedAtOf, feedIdOf, typedData, typedDataV2, need, median, ethers };
