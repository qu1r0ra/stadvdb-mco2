import { nodes } from "../config/db.js";

// Failover state
const state = {
  node1Status: 'healthy', // 'healthy' | 'down'
  failoverMode: false,
  lastHealthCheck: null,
  consecutiveFailures: 0,
};

const HEALTH_CHECK_INTERVAL_MS = 5000; // 5 seconds
const FAILURE_THRESHOLD = 3; // 3 consecutive failures = down

/**
 * Check if Node 1 is available
 */
export async function checkNode1Health() {
  try {
    await nodes.node1.pool.query('SELECT 1');
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Get current failover status
 */
export function getFailoverStatus() {
  return {
    node1Status: state.node1Status,
    failoverMode: state.failoverMode,
    lastHealthCheck: state.lastHealthCheck,
    consecutiveFailures: state.consecutiveFailures,
  };
}

/**
 * Check if Node 1 is available (cached with health monitoring)
 */
export function isNode1Available() {
  return state.node1Status === 'healthy';
}

/**
 * Manually promote Node 2/3 to masters
 */
export function promoteSlaves() {
  console.log('[FAILOVER] Manually promoting Node 2/3 to masters');
  state.node1Status = 'down';
  state.failoverMode = true;
  return getFailoverStatus();
}

/**
 * Manually demote Node 2/3 to slaves
 */
export function demoteSlaves() {
  console.log('[FAILOVER] Manually demoting Node 2/3 to slaves');
  state.node1Status = 'healthy';
  state.failoverMode = false;
  state.consecutiveFailures = 0;
  return getFailoverStatus();
}

/**
 * Health monitoring loop
 */
async function healthMonitoringLoop() {
  const isHealthy = await checkNode1Health();
  state.lastHealthCheck = new Date().toISOString();

  if (isHealthy) {
    // Node 1 is healthy
    if (state.node1Status === 'down') {
      // Node 1 has recovered!
      console.log('[FAILOVER] Node 1 recovered! Demoting Node 2/3 to slaves...');
      state.consecutiveFailures = 0;
      state.node1Status = 'healthy';
      state.failoverMode = false;
    } else {
      // Reset failure counter
      state.consecutiveFailures = 0;
    }
  } else {
    // Node 1 is down
    state.consecutiveFailures++;
    console.warn(`[FAILOVER] Node 1 health check failed (${state.consecutiveFailures}/${FAILURE_THRESHOLD})`);

    if (state.consecutiveFailures >= FAILURE_THRESHOLD && state.node1Status === 'healthy') {
      // Trigger failover
      console.error('[FAILOVER] Node 1 is DOWN! Promoting Node 2/3 to masters...');
      state.node1Status = 'down';
      state.failoverMode = true;
    }
  }
}

/**
 * Start health monitoring
 */
export function startHealthMonitoring() {
  console.log(`[FAILOVER] Starting health monitoring (interval: ${HEALTH_CHECK_INTERVAL_MS}ms, threshold: ${FAILURE_THRESHOLD})`);

  // Run immediately
  healthMonitoringLoop();

  // Then run periodically
  setInterval(healthMonitoringLoop, HEALTH_CHECK_INTERVAL_MS);
}
