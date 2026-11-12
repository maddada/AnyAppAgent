// The fence around automation scripts (automations/<id>.ts). Runs inside Babel, so every build
// (the full one and the quick fast-lane one) checks and wraps every script the same way.
//
// What it does, in order (docs: AGENTS.md, "Automations"):
//   1. Checks the script: no imports or requires, no names outside the automation API and a short
//      list of safe built-ins, no `constructor` / `prototype` / `__proto__` style names. A script that
//      breaks a rule fails the build with a plain message, which goes back to the agent to fix.
//   2. Guards what cannot be checked before it runs: `x[key]` goes through $get/$set/$call (which
//      refuse the forbidden names), and every loop body starts with $tick() (the run's time budget).
//   3. Records what the script can do, straight from its code: the powers it uses and each call
//      with its literal arguments ("speak('Maghrib time')"). The card the person approves is drawn
//      from this, never from the agent's own description.
//   4. Wraps the whole file into { id, hash, source, powers, actions, define($api) }, so the script
//      only ever sees the names the runtime hands it. `hash` ties the person's approval to this
//      exact source: a changed script needs a new OK before it runs again.
//
// It is a language-level fence inside the app's own JavaScript runtime, not a separate process:
// it keeps scripts to the API (and so to the safety rails behind it), it does not defend against
// someone who can change the app's own code (only the app's owner and their agent can).
const crypto = require('crypto');
const path = require('path');

/** Names the runtime hands every script (src/automate/api.ts builds them). Keep in step. */
const API = [
  'automation',
  // triggers
  'at',
  'prayer',
  'every',
  'charging',
  'wifi',
  'bluetooth',
  'notification',
  // powers
  'speak',
  'notify',
  'doNotDisturb',
  'web',
  // helpers
  'sleep',
  'log',
  'now',
  'prayerTimes',
  'memory',
];

/** Fence helpers the rewrite below calls. Never written by hand. */
const HELPERS = ['$get', '$set', '$call', '$del', '$upd', '$tick'];

/** Powers: what the card lists under "It can". */
const POWERS = {
  speak: 'speak',
  notify: 'notify',
  doNotDisturb: 'doNotDisturb',
  web: 'web',
};

/** Built-ins a script may use. Everything else (fetch, require, globalThis, Function, Object, Reflect, Proxy, setTimeout, ...) is out of reach. */
const SAFE_GLOBALS = [
  'Math',
  'JSON',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Date',
  'Map',
  'Set',
  'Promise',
  'Error',
  'RangeError',
  'TypeError',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'undefined',
  'NaN',
  'Infinity',
];

/** Property names no script may touch: the ways out of a fence like this one. */
const BLOCKED_PROPS = new Set([
  'constructor',
  'prototype',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'caller',
  'callee',
  'arguments',
]);

/** TypeScript nodes that hold a value (the rest are types and are skipped). */
const TS_VALUE_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression']);

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** Only automations/<id>.ts (not index.ts, not .d.ts) are scripts. */
function isScript(filename) {
  if (!filename) return false;
  const norm = filename.replace(/\\/g, '/');
  const m = /\/automations\/([^/]+)\.ts$/.exec(norm);
  if (!m) return false;
  if (m[1] === 'index' || m[1].endsWith('.d')) return false;
  return !norm.includes('/node_modules/');
}

function inTypePosition(p) {
  for (let q = p.parentPath; q; q = q.parentPath) {
    const ty = q.node.type;
    if (ty.startsWith('TS') && !TS_VALUE_WRAPPERS.has(ty)) return true;
  }
  return false;
}

/** A literal argument as plain data for the card, or undefined when it is worked out at run time. */
function literal(node) {
  if (!node) return undefined;
  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'TemplateLiteral':
      return node.expressions.length === 0 ? node.quasis.map((q) => q.value.cooked).join('') : undefined;
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'NumericLiteral') return -node.argument.value;
      return undefined;
    case 'ObjectExpression': {
      const out = {};
      for (const prop of node.properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed) return undefined;
        const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
        const v = literal(prop.value);
        if (v === undefined) out[key] = null; // worked out when it runs
        else out[key] = v;
      }
      return out;
    }
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return literal(node.expression);
    default:
      return undefined;
  }
}

module.exports = function automateFence({ types: t, template }) {
  const checker = {
    'ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration|Import|MetaProperty'(p, s) {
      s.problem(p, 'Automations cannot import or export anything. Use only the automation API (see AGENTS.md, "Automations").');
    },
    'TSModuleDeclaration|TSEnumDeclaration|TSImportEqualsDeclaration|TSExportAssignment|TSDeclareFunction'(p, s) {
      s.problem(p, 'Keep automations to plain code: no namespaces, enums, declare or import =.');
    },
    ExportDefaultDeclaration(p, s) {
      s.exports += 1;
      const d = p.node.declaration;
      const call = d.type === 'TSAsExpression' || d.type === 'TSSatisfiesExpression' ? d.expression : d;
      if (call.type !== 'CallExpression' || call.callee.type !== 'Identifier' || call.callee.name !== 'automation') {
        s.problem(p, 'The one export must be: export default automation({ name, says, when, run }).');
      }
    },
    Identifier(p, s) {
      if (!p.isReferencedIdentifier() || inTypePosition(p)) return;
      const name = p.node.name;
      if (p.scope.hasBinding(name, true)) return;
      if (API.includes(name) || SAFE_GLOBALS.includes(name)) {
        if (Object.prototype.hasOwnProperty.call(POWERS, name)) s.powers.add(POWERS[name]);
        return;
      }
      if (HELPERS.includes(name)) {
        s.problem(p, `${name} is reserved for the fence.`);
        return;
      }
      s.problem(p, `"${name}" is not available in an automation. Use only the automation API (see AGENTS.md, "Automations").`);
    },
    'MemberExpression|OptionalMemberExpression'(p, s) {
      const { property, computed } = p.node;
      const name = !computed && property.type === 'Identifier' ? property.name : property.type === 'StringLiteral' ? property.value : null;
      if (name !== null && BLOCKED_PROPS.has(name)) s.problem(p, `".${name}" is not allowed in an automation.`);
      if (p.node.type === 'OptionalMemberExpression' && computed && property.type !== 'NumericLiteral' && property.type !== 'StringLiteral') {
        s.problem(p, 'Use x?.name or check x first: x?.[key] is not allowed in an automation.');
      }
    },
    'ObjectProperty|ObjectMethod|ClassMethod|ClassProperty'(p, s) {
      const { key, computed } = p.node;
      const name = !computed && key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : null;
      if (name !== null && BLOCKED_PROPS.has(name) && name !== 'constructor') s.problem(p, `"${name}" is not allowed as a name in an automation.`);
      if (name === 'constructor' && p.parentPath.isObjectPattern()) s.problem(p, '"constructor" is not allowed in an automation.');
      if (computed && p.parentPath.isObjectPattern()) s.problem(p, 'Computed names in destructuring are not allowed in an automation.');
    },
    ThisExpression(p, s) {
      if (!p.getFunctionParent()) s.problem(p, '"this" is not available at the top of an automation.');
    },
    CallExpression(p, s) {
      // Record each power call with its literal arguments: the card is drawn from these.
      const callee = p.node.callee;
      let call = null;
      if (callee.type === 'Identifier' && POWERS[callee.name] && !p.scope.hasBinding(callee.name, true)) call = callee.name;
      else if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        POWERS[callee.object.name] &&
        !p.scope.hasBinding(callee.object.name, true) &&
        callee.property.type === 'Identifier'
      ) {
        call = `${callee.object.name}.${callee.property.name}`;
      }
      if (call) {
        s.actions.push({
          call,
          args: p.get('arguments').map((a) => {
            // Babel works out constants too: { minutes: MINUTES } with const MINUTES = 20.
            const e = a.evaluate();
            if (e.confident && e.value !== undefined && typeof e.value !== 'function') return e.value;
            const v = literal(a.node);
            return v === undefined ? null : v;
          }),
          line: p.node.loc ? p.node.loc.start.line : 0,
        });
      }
    },
  };

  const buildGet = template.expression('$get(OBJ, KEY)');
  const buildSet = template.expression('$set(OBJ, KEY, VALUE)');
  const buildCall = template.expression('$call(OBJ, KEY, ARGS)');
  const buildDel = template.expression('$del(OBJ, KEY)');
  const buildUpd = template.expression('$upd(OBJ, KEY, FN)');

  const needsGuard = (member) =>
    member.computed && member.property.type !== 'NumericLiteral' && member.property.type !== 'StringLiteral';

  const guards = {
    MemberExpression: {
      exit(p) {
        const node = p.node;
        if (!needsGuard(node)) return;
        const parent = p.parentPath;
        if (parent.isAssignmentExpression({ left: node })) {
          const op = parent.node.operator;
          if (op === '=') {
            parent.replaceWith(buildSet({ OBJ: node.object, KEY: node.property, VALUE: parent.node.right }));
          } else {
            const old = p.scope.generateUidIdentifier('old');
            const fn = t.arrowFunctionExpression([old], t.binaryExpression(op.slice(0, -1), old, parent.node.right));
            parent.replaceWith(buildUpd({ OBJ: node.object, KEY: node.property, FN: fn }));
          }
          return;
        }
        if (parent.isUpdateExpression({ argument: node })) {
          const old = p.scope.generateUidIdentifier('old');
          const fn = t.arrowFunctionExpression([old], t.binaryExpression(parent.node.operator === '++' ? '+' : '-', old, t.numericLiteral(1)));
          // $upd returns the new value; a postfix x[k]++ wants the old one.
          const upd = buildUpd({ OBJ: node.object, KEY: node.property, FN: fn });
          parent.replaceWith(
            parent.node.prefix ? upd : t.binaryExpression(parent.node.operator === '++' ? '-' : '+', upd, t.numericLiteral(1)),
          );
          return;
        }
        if (parent.isCallExpression({ callee: node })) {
          parent.replaceWith(buildCall({ OBJ: node.object, KEY: node.property, ARGS: t.arrayExpression(parent.node.arguments) }));
          return;
        }
        if (parent.isUnaryExpression({ operator: 'delete', argument: node })) {
          parent.replaceWith(buildDel({ OBJ: node.object, KEY: node.property }));
          return;
        }
        if (parent.isForXStatement({ left: node }) || parent.isArrayPattern() || parent.isAssignmentPattern({ left: node }) || parent.isObjectProperty({ value: node })) {
          if (parent.isObjectProperty() && !parent.parentPath.isObjectPattern()) {
            p.replaceWith(buildGet({ OBJ: node.object, KEY: node.property }));
            return;
          }
          throw p.buildCodeFrameError('Assigning to x[key] inside destructuring or a for loop is not allowed in an automation.');
        }
        p.replaceWith(buildGet({ OBJ: node.object, KEY: node.property }));
      },
    },
    'ForStatement|WhileStatement|DoWhileStatement|ForInStatement|ForOfStatement'(p) {
      const body = p.get('body');
      const tick = t.expressionStatement(t.callExpression(t.identifier('$tick'), []));
      if (body.isBlockStatement()) body.unshiftContainer('body', tick);
      else body.replaceWith(t.blockStatement([tick, body.node]));
    },
  };

  return {
    name: 'appwin-automate-fence',
    visitor: {
      Program(programPath, state) {
        const filename = state.filename || (state.file && state.file.opts && state.file.opts.filename);
        if (!isScript(filename)) return;
        const id = path.basename(filename, '.ts');
        const source = state.file.code;
        const problems = [];
        const s = {
          exports: 0,
          powers: new Set(),
          actions: [],
          problem(p, message) {
            const line = p.node.loc ? p.node.loc.start.line : '?';
            problems.push(`automations/${id}.ts line ${line}: ${message}`);
          },
        };
        if (!ID.test(id)) problems.push(`automations/${id}.ts: the file name is the automation's id: lowercase letters, digits and dashes only.`);
        programPath.traverse(checker, s);
        if (s.exports !== 1) problems.push(`automations/${id}.ts: needs exactly one "export default automation({ ... })".`);
        if (problems.length) {
          throw programPath.buildCodeFrameError(`This automation breaks the automation rules (AGENTS.md, "Automations"):\n  ${problems.join('\n  ')}`);
        }

        programPath.traverse(guards);

        // The export becomes the define() result.
        const body = programPath.node.body.filter((n) => !t.isTSInterfaceDeclaration(n) && !t.isTSTypeAliasDeclaration(n));
        const scriptId = programPath.scope.generateUidIdentifier('script');
        const out = [];
        for (const node of body) {
          if (t.isExportDefaultDeclaration(node)) out.push(t.variableDeclaration('const', [t.variableDeclarator(scriptId, node.declaration)]));
          else out.push(node);
        }
        out.push(t.returnStatement(scriptId));
        const types = programPath.node.body.filter((n) => t.isTSInterfaceDeclaration(n) || t.isTSTypeAliasDeclaration(n));

        const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
        const names = [...API, ...HELPERS];
        const meta = t.valueToNode({
          id,
          hash,
          source,
          powers: [...s.powers].sort(),
          actions: s.actions,
        });
        const define = t.functionExpression(
          null,
          [t.identifier('$api')],
          t.blockStatement(
            [
              t.variableDeclaration('const', [
                t.variableDeclarator(
                  t.objectPattern(names.map((n) => t.objectProperty(t.identifier(n), t.identifier(n), false, true))),
                  t.identifier('$api'),
                ),
              ]),
              ...out,
            ],
            [t.directive(t.directiveLiteral('use strict'))],
          ),
        );
        meta.properties.push(t.objectProperty(t.identifier('define'), define));
        programPath.node.body = [...types, t.exportDefaultDeclaration(meta)];
        programPath.node.directives = [];
      },
    },
  };
};

module.exports.isScript = isScript;
module.exports.API = API;
module.exports.SAFE_GLOBALS = SAFE_GLOBALS;
module.exports.BLOCKED_PROPS = BLOCKED_PROPS;
