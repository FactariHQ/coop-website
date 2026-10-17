(function(){
/**
 * Factari CoOp — ABA Business Assessment scoring engine.
 *
 * Pure, dependency-free, and shared byte-for-byte between the browser bundle,
 * the serverless submit handler, and the unit tests. All tunable numbers live in
 * content/assessment/scoring.json — this file only knows how to apply them.
 */

const EXISTING_SEGMENTS = ['need_help', 'stable', 'growing', 'exiting'];
const LAUNCH_SEGMENTS = ['thinking', 'preparing', 'recent'];

function trackFor(answers) {
  return LAUNCH_SEGMENTS.includes(answers.segment) ? 'launch' : 'existing';
}

function arr(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function textDefined(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  if (s.length < 2) return false;
  return !/^(not sure|unsure|no|none|n\/a|na|tbd|undecided|still deciding|deciding|don'?t know|idk)$/.test(s);
}

/** Score one component definition against the answer set. Returns 0-1. */
function componentRatio(def, answers) {
  if (def.map && def.question) {
    const raw = answers[def.question];
    const values = arr(raw);
    if (!values.length) return 0.4;
    // multi-select: take the best-scoring selection
    let best = 0;
    for (const v of values) best = Math.max(best, def.map[v] ?? 0.3);
    return clamp01(best);
  }

  if (def.maxOf) {
    let best = 0;
    for (const sub of def.maxOf) best = Math.max(best, componentRatio(sub, answers));
    return clamp01(best);
  }

  if (def.flags) {
    const selected = arr(answers.ops_challenges);
    if (selected.includes('none')) return 1;
    let ratio = 1;
    for (const flag of def.flags) {
      if (selected.includes(flag)) ratio -= def.penalty;
    }
    return clamp01(Math.max(def.floor ?? 0, ratio));
  }

  if (def.countOf) {
    const selected = arr(answers[def.countOf]);
    if (def.noneValue && selected.includes(def.noneValue)) return def.noneScore ?? 0.05;
    if (def.allValue && selected.includes(def.allValue)) return def.allScore ?? 1;
    const pool = def.only ? selected.filter((v) => def.only.includes(v)) : selected.filter((v) => v !== 'none' && v !== 'unsure');
    return clamp01(pool.length / (def.target || 5));
  }

  if (def.textDefined) {
    return textDefined(answers[def.textDefined]) ? def.definedValue ?? 1 : def.undefinedValue ?? 0.3;
  }

  if (def.multiStateFrom) {
    const states = arr(answers[def.multiStateFrom]);
    if (states.length > 1) return def.multiValue ?? 1;
    if (arr(answers.strategic_intent).includes(def.expandIntent)) return def.intentValue ?? 0.8;
    return def.baseValue ?? 0.25;
  }

  if (def.fit) {
    const years = answers[def.fit.yearsQuestion];
    const bcbas = answers[def.fit.bcbaQuestion];
    let ratio = 0.3;
    if (def.fit.goodYears.includes(years)) ratio += 0.35;
    if (def.fit.goodBcbas.includes(bcbas)) ratio += 0.35;
    return clamp01(ratio);
  }

  return 0.4;
}

function scoreSet(defs, answers) {
  const components = {};
  let total = 0;
  let weightTotal = 0;
  for (const [key, def] of Object.entries(defs)) {
    let ratio = componentRatio(def, answers);
    if (def.bonusIfIntent) {
      const intents = arr(answers.strategic_intent);
      if (def.bonusIfIntent.values.some((v) => intents.includes(v))) {
        ratio = clamp01(ratio + def.bonusIfIntent.add);
      }
    }
    const points = ratio * def.weight;
    components[key] = { ratio: round(ratio, 3), weight: def.weight, points: round(points, 2) };
    total += points;
    weightTotal += def.weight;
  }
  const score = weightTotal ? Math.round((total / weightTotal) * 100) : 0;
  return { score, components };
}

function round(n, places) {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}

/* ---------------------------------------------------------------- insights */

const EXISTING_INSIGHT_RULES = [
  { id: 'cash', when: (a) => ['tight', 'serious'].includes(a.fin_cash) || arr(a.ops_challenges).includes('cashflow') || a.owner_experience === 'cash_stress' },
  { id: 'ar', when: (a) => ['2to3', 'gt3', 'unsure'].includes(a.fin_ar) || arr(a.ops_challenges).includes('ar') },
  { id: 'billing', when: (a) => arr(a.ops_challenges).includes('billing') },
  { id: 'profitability', when: (a) => ['breakeven', 'losing', 'unsure'].includes(a.fin_profit) || arr(a.ops_challenges).includes('profitability') || a.owner_experience === 'busy_broke' },
  { id: 'credentialing', when: (a) => arr(a.ops_challenges).includes('credentialing') },
  { id: 'recruit_bcba', when: (a) => arr(a.ops_challenges).includes('recruit_bcba') || a.owner_experience === 'cant_hire' },
  { id: 'recruit_rbt', when: (a) => arr(a.ops_challenges).includes('recruit_rbt') },
  { id: 'retention', when: (a) => arr(a.ops_challenges).includes('retention') },
  { id: 'authorizations', when: (a) => arr(a.ops_challenges).includes('authorizations') },
  { id: 'clients', when: (a) => arr(a.ops_challenges).includes('clients') || a.owner_experience === 'need_clients' },
  { id: 'owner_dependence', when: (a) => ['major', 'cant'].includes(a.owner_dependence) || arr(a.strategic_intent).includes('other_operator') || a.owner_experience === 'less_of_me' },
  { id: 'burnout', when: (a) => arr(a.ops_challenges).includes('burnout') || ['too_much_me', 'exhausted'].includes(a.owner_experience) },
  { id: 'leadership', when: (a) => arr(a.ops_challenges).includes('leadership') },
  { id: 'scheduling', when: (a) => arr(a.ops_challenges).includes('scheduling') || a.owner_experience === 'chaos' },
  { id: 'compliance', when: (a) => arr(a.ops_challenges).includes('compliance') },
  { id: 'technology', when: (a) => arr(a.ops_challenges).includes('technology') },
  { id: 'data', when: (a) => arr(a.ops_challenges).includes('data') || a.fin_growth === 'unsure' || a.fin_profit === 'unsure' },
  { id: 'growth', when: (a) => arr(a.ops_challenges).includes('growth') || ['grow_faster', 'much_larger'].includes(a.owner_experience) },
  { id: 'hr', when: (a) => arr(a.ops_challenges).includes('hr') },
  { id: 'clinical_ops', when: (a) => arr(a.ops_challenges).includes('clinical_ops') },
  { id: 'multistate', when: (a) => arr(a.co_states).length > 1 || arr(a.strategic_intent).includes('expand') },
  { id: 'coop_leverage', when: (a) => arr(a.coop_interest).filter((v) => v !== 'none').length >= 2 },
  { id: 'strategic', when: (a, cfg) => cfg.thresholds.acquisitionSignals.includes(a.transaction_interest) || arr(a.strategic_intent).includes('sold') },
  { id: 'valuation_readiness', when: (a, cfg) => cfg.thresholds.acquisitionSignals.concat(['partner']).includes(a.transaction_interest) },
];

const LAUNCH_INSIGHT_RULES = [
  { id: 'launch_capital', when: (a) => ['lt25', '25to50', 'financing'].includes(a.launch_capital) || a.launch_obstacle === 'capital' || arr(a.launch_help).includes('capital') },
  { id: 'launch_credentialing', when: (a) => ['researching', 'not_started', 'submitted'].includes(a.launch_credentialing) || a.launch_obstacle === 'credentialing' || arr(a.launch_help).includes('credentialing') },
  { id: 'launch_market', when: (a) => !textDefined(a.launch_market) || a.launch_obstacle === 'market' || arr(a.launch_help).includes('market') },
  { id: 'launch_entity', when: (a) => ['no', 'unsure', 'progress'].includes(a.launch_entity) },
  { id: 'launch_npi', when: (a) => ['no', 'unsure', 'individual'].includes(a.launch_npi) },
  { id: 'launch_clients', when: (a) => ['interest', 'none'].includes(a.launch_clients) || a.launch_obstacle === 'clients' || arr(a.launch_help).includes('clients') },
  { id: 'launch_staff', when: (a) => ['none', 'few'].includes(a.launch_staff) || a.launch_obstacle === 'staffing' || arr(a.launch_help).includes('recruiting') },
  { id: 'launch_billing', when: (a) => arr(a.launch_help).includes('billing') },
  { id: 'launch_operations', when: (a) => arr(a.launch_help).includes('operations') },
  { id: 'launch_compliance', when: (a) => arr(a.launch_help).includes('compliance') || a.launch_obstacle === 'compliance' },
  { id: 'launch_technology', when: (a) => arr(a.launch_help).includes('technology') },
  { id: 'launch_time', when: (a) => a.launch_involvement === 'pt_employed' || a.launch_obstacle === 'time' },
  { id: 'launch_knowledge', when: (a) => a.launch_obstacle === 'knowledge' || a.launch_obstacle === 'confidence' || arr(a.launch_help).includes('everything') || arr(a.launch_help).includes('unsure') },
];

function pickInsights(answers, config, results, track, limit = 3) {
  const rules = track === 'launch' ? LAUNCH_INSIGHT_RULES : EXISTING_INSIGHT_RULES;
  const hits = [];
  for (const rule of rules) {
    let matched = false;
    try { matched = !!rule.when(answers, config); } catch { matched = false; }
    if (!matched) continue;
    const meta = results.insights[rule.id];
    if (!meta) continue;
    hits.push({ id: rule.id, priority: meta.priority ?? 0, title: meta.title, body: meta.body });
  }
  hits.sort((a, b) => b.priority - a.priority);
  return hits.slice(0, limit);
}

/* -------------------------------------------------------- classification */

function classify(answers, config, health, opportunity, track) {
  const t = config.thresholds;
  const tags = [];
  const secondary = [];
  const transaction = answers.transaction_interest;
  const intents = arr(answers.strategic_intent);

  const hardExit =
    t.acquisitionSignals.includes(transaction) ||
    answers.segment === 'exiting' ||
    intents.includes('sold') ||
    answers.owner_experience === 'exhausted';

  let primary;
  if (track === 'launch') {
    primary = health.score >= t.nurtureCeiling ? 'LAUNCH' : 'LOW PRIORITY / NURTURE';
    if (answers.launch_timing === 'gt12' && health.score < t.launchReady) secondary.push('EARLY / NURTURE');
  } else if (hardExit) {
    primary = 'ACQUISITION OPPORTUNITY';
    if (health.score < t.distressCeiling) secondary.push('STABILIZE');
    else secondary.push('GROW');
  } else if (health.score < t.distressCeiling || ['tight', 'serious'].includes(answers.fin_cash) || answers.fin_profit === 'losing') {
    primary = 'STABILIZE';
    if (opportunity.score >= t.coopFloor) secondary.push('GROW');
  } else if (health.score >= t.healthyFloor && opportunity.score >= t.coopFloor) {
    primary = 'GROW';
  } else if (health.score >= t.healthyFloor) {
    primary = 'GROW';
    secondary.push('LOW COOP FIT');
  } else {
    primary = 'STABILIZE';
  }

  if (t.acquisitionSoftSignals.includes(transaction) && primary !== 'ACQUISITION OPPORTUNITY') {
    secondary.push('TRANSACTION CURIOUS');
  }

  // Tags
  if (track === 'launch') {
    tags.push('LAUNCH');
    if (answers.launch_state) tags.push(answers.launch_state);
    if (answers.launch_capital) tags.push('CAPITAL:' + answers.launch_capital.toUpperCase());
    if (answers.launch_timing) tags.push('TIMING:' + answers.launch_timing.toUpperCase());
    if (['bcba_leader', 'bcba'].includes(answers.launch_background)) tags.push('BCBA');
  } else {
    for (const s of arr(answers.co_states)) tags.push(s);
    if (answers.fin_revenue) tags.push('REV:' + answers.fin_revenue.toUpperCase());
    if (arr(answers.co_payers).some((p) => p.startsWith('medicaid'))) tags.push('MEDICAID');
    if (arr(answers.co_states).length > 1) tags.push('MULTISTATE');
    if (intents.includes('expand')) tags.push('EXPANSION INTEREST');
    if (transaction && transaction !== 'no') tags.push('TXN:' + transaction.toUpperCase());
    if (arr(answers.coop_interest).filter((v) => v !== 'none').length >= 3) tags.push('SHARED SERVICES FIT');
  }

  return { primary, secondary: [...new Set(secondary)], tags: [...new Set(tags)] };
}

/* -------------------------------------------------------------- alerts */

function alertsFor(answers, config, health, opportunity, track, classification) {
  const t = config.thresholds;
  const alerts = [];

  if (track === 'existing' && ['tight', 'serious'].includes(answers.fin_cash) && t.hotDistressRevenue.includes(answers.fin_revenue)) {
    alerts.push({
      key: 'HOT_DISTRESSED_LEAD',
      label: 'Hot distressed lead',
      severity: 'high',
      why: `Existing company at ${labelForRevenue(answers.fin_revenue)} reporting cash as "${answers.fin_cash === 'serious' ? 'a serious concern' : 'tight'}"${answers.fin_profit === 'losing' ? ' and currently losing money' : ''}. Business Health ${health.score}/100.`,
    });
  }

  if (t.acquisitionSignals.includes(answers.transaction_interest) || answers.segment === 'exiting') {
    alerts.push({
      key: 'ACQUISITION_LEAD',
      label: 'Acquisition lead',
      severity: 'high',
      why: `Owner selected "${transactionLabel(answers.transaction_interest)}"${answers.segment === 'exiting' ? ' and entered via the selling/stepping-away segment' : ''}. Revenue ${labelForRevenue(answers.fin_revenue)}, Business Health ${health.score}/100.`,
    });
  }

  if (
    track === 'existing' &&
    health.score >= t.highValueCoopHealth &&
    opportunity.score >= t.highValueCoopScore &&
    t.highValueCoopRevenue.includes(answers.fin_revenue)
  ) {
    alerts.push({
      key: 'HIGH_VALUE_COOP_LEAD',
      label: 'High-value CoOp lead',
      severity: 'high',
      why: `Healthy company at ${labelForRevenue(answers.fin_revenue)} — Health ${health.score}/100, CoOp Opportunity ${opportunity.score}/100, willing to hand off ${arr(answers.coop_interest).filter((v) => v !== 'none').length} functions.`,
    });
  }

  if (
    track === 'launch' &&
    t.highPotentialLaunchBackground.includes(answers.launch_background) &&
    t.highPotentialLaunchTiming.includes(answers.launch_timing) &&
    t.highPotentialLaunchCapital.includes(answers.launch_capital) &&
    textDefined(answers.launch_market)
  ) {
    alerts.push({
      key: 'HIGH_POTENTIAL_LAUNCH',
      label: 'High-potential launch',
      severity: 'high',
      why: `Certified BCBA, market identified (${answers.launch_market}), targeting ${timingLabel(answers.launch_timing)}, capital ${capitalLabel(answers.launch_capital)}. Launch Readiness ${health.score}/100.`,
    });
  }

  if (classification.primary === 'STABILIZE' && arr(answers.ops_challenges).length >= 6) {
    alerts.push({
      key: 'BROAD_CONSTRAINT_LOAD',
      label: 'Broad constraint load',
      severity: 'medium',
      why: `Owner flagged ${arr(answers.ops_challenges).length} simultaneous challenges. Likely needs constraint triage before any single-function fix.`,
    });
  }

  return alerts;
}

const REVENUE_LABELS = {
  lt500k: 'under $500K', '500kto1m': '$500K–$1M', '1to2m': '$1M–$2M',
  '2to5m': '$2M–$5M', '5to10m': '$5M–$10M', gt10m: '$10M+',
};
const TRANSACTION_LABELS = {
  no: 'No', not_now: 'Possibly, but not now', partner: 'Would consider a partner',
  sell_part: 'Would consider selling part', sell_all: 'Would consider selling the company',
  active_exit: 'Actively looking for an exit',
};
const TIMING_LABELS = {
  already: 'already seeing clients', lt3: 'within 3 months', '3to6': '3–6 months',
  '6to12': '6–12 months', gt12: '12+ months', unsure: 'undecided',
};
const CAPITAL_LABELS = {
  lt25: 'under $25K', '25to50': '$25–50K', '50to100': '$50–100K',
  '100to250': '$100–250K', gt250: '$250K+', financing: 'needs financing',
};
function labelForRevenue(v) { return REVENUE_LABELS[v] || 'unknown revenue'; }
function transactionLabel(v) { return TRANSACTION_LABELS[v] || v; }
function timingLabel(v) { return TIMING_LABELS[v] || v; }
function capitalLabel(v) { return CAPITAL_LABELS[v] || v; }

/* ------------------------------------------------------- result category */

function resultCategoryFor(answers, config, health, opportunity, track, classification) {
  const t = config.thresholds;
  if (classification.primary === 'ACQUISITION OPPORTUNITY') return 'strategic_options';
  if (track === 'launch') return health.score >= t.launchReady ? 'launch_ready' : 'build_foundation';
  if (classification.primary === 'STABILIZE') {
    if (['lt1', '1to2'].includes(answers.co_years) && ['lt500k', '500kto1m'].includes(answers.fin_revenue)) return 'build_foundation';
    return 'stabilize';
  }
  return 'ready_to_scale';
}

/* ------------------------------------------------------------- evaluate */

function evaluate(answers, config, results) {
  const track = trackFor(answers);
  const health = scoreSet(config.health[track], answers);
  const opportunity = scoreSet(config.opportunity[track], answers);
  const classification = classify(answers, config, health, opportunity, track);
  const category = resultCategoryFor(answers, config, health, opportunity, track, classification);
  const alerts = alertsFor(answers, config, health, opportunity, track, classification);
  const insights = results ? pickInsights(answers, config, results, track, 3) : [];

  return {
    track,
    businessHealthScore: health.score,
    coopOpportunityScore: opportunity.score,
    healthComponents: health.components,
    opportunityComponents: opportunity.components,
    classification: classification.primary,
    secondaryClassifications: classification.secondary,
    tags: classification.tags,
    resultCategory: category,
    alerts,
    insights,
  };
}

const _internal = { componentRatio, scoreSet, textDefined, pickInsights };

window.CoopScoring = { evaluate: evaluate, trackFor: trackFor, classify: classify, alertsFor: alertsFor, resultCategoryFor: resultCategoryFor };
})();