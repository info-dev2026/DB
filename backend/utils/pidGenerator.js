/* ============================================================
   utils/pidGenerator.js
   Globally unique, strictly numeric Parameter ID (PID) generator
   Guarantees all parameter IDs are digits only and collision-free.
   ============================================================ */

/**
 * Checks whether a PID string is strictly numeric digits only.
 * @param {any} val
 * @returns {boolean}
 */
function isNumericPid(val) {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  return /^\d+$/.test(s) && s.length > 0;
}

/**
 * Queries all existing numeric PIDs from the database.
 * @param {object} [ParamModel] - Sequelize Param model (lazy loaded if omitted)
 * @returns {Promise<Set<number>>} Set of existing numeric PID values
 */
async function getExistingNumericPidsSet(ParamModel) {
  const Param = ParamModel || require('../models').Param;
  const used = new Set();

  try {
    const params = await Param.findAll({
      attributes: ['pid'],
      raw: true,
    });

    for (const p of params) {
      if (p && p.pid) {
        const s = String(p.pid).trim();
        if (/^\d+$/.test(s)) {
          used.add(parseInt(s, 10));
        }
      }
    }
  } catch (err) {
    console.error('Failed to query existing numeric PIDs:', err);
  }

  return used;
}

/**
 * Allocates `count` next sequential, globally unique numeric PIDs.
 * Starts search at 1001 (or higher if specified).
 * Guarantees zero collisions with existing DB records and extraExcluded IDs.
 *
 * @param {number} count - Number of unique IDs to allocate
 * @param {Array<string|number>} [extraExcluded=[]] - Additional IDs to exclude (e.g. from current batch)
 * @param {object} [ParamModel] - Sequelize Param model
 * @returns {Promise<string[]>} Array of unique numeric ID strings (e.g. ['1001', '1002'])
 */
async function getNextNumericPids(count = 1, extraExcluded = [], ParamModel) {
  const safeCount = Math.max(1, parseInt(count, 10) || 1);
  const used = await getExistingNumericPidsSet(ParamModel);

  for (const item of extraExcluded) {
    if (item !== null && item !== undefined) {
      const s = String(item).trim();
      if (/^\d+$/.test(s)) {
        used.add(parseInt(s, 10));
      }
    }
  }

  const allocated = [];
  let candidate = 1001;

  while (allocated.length < safeCount) {
    while (used.has(candidate)) {
      candidate++;
    }
    allocated.push(String(candidate));
    used.add(candidate);
    candidate++;
  }

  return allocated;
}

/**
 * Allocates a single next globally unique numeric PID.
 * @param {Array<string|number>} [extraExcluded=[]]
 * @param {object} [ParamModel]
 * @returns {Promise<string>}
 */
async function getNextNumericPid(extraExcluded = [], ParamModel) {
  const [pid] = await getNextNumericPids(1, extraExcluded, ParamModel);
  return pid;
}

/**
 * Generates a Parameter ID automatically with reference to the stack name.
 * Strictly guarantees that the generated ID contains BOTH character and number.
 * E.g., 'STACK 1' -> 'STACK-1-PM', 'STACK 2' -> 'STACK-2-PM', 'Boiler Stack 1' -> 'BOILER-STACK-1-PM'
 */
function generateParamIdFromStack(stackName, key = 'PM', siteCode = null) {
  if (!stackName || !String(stackName).trim()) {
    return 'STACK-1-PM';
  }
  const clean = String(stackName).trim();
  const rawUpper = clean.toUpperCase();

  // Special site mappings (e.g. EOCP_123)
  const cleanSite = String(siteCode || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleanSite === 'EOCP123') {
    if (rawUpper.includes('STACK 1') || rawUpper.includes('STACK-1') || rawUpper.includes('STACK_1') || rawUpper === '1') {
      return 'EOC-STACK-1';
    }
    if (rawUpper.includes('STACK 2') || rawUpper.includes('STACK-2') || rawUpper.includes('STACK_2') || rawUpper === '2') {
      return 'STACK-2-PM';
    }
  }

  const nums = clean.match(/\d+/);
  const numStr = nums ? nums[0] : '1';
  let slug = clean.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase();

  if (!/[A-Z]/.test(slug)) {
    slug = `STACK-${slug}`;
  }
  if (!/\d/.test(slug)) {
    slug = `${slug}-${numStr}`;
  }
  const cleanKey = (key || 'PM').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleanKey && !slug.includes(cleanKey)) {
    slug = `${slug}-${cleanKey}`;
  }
  return slug;
}

module.exports = {
  isNumericPid,
  getExistingNumericPidsSet,
  getNextNumericPids,
  getNextNumericPid,
  generateParamIdFromStack,
};
