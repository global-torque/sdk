#!/usr/bin/env node

import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';
import { format, resolveConfig } from 'prettier';

const packageDirectory = path.resolve(import.meta.dirname, '..');
const root = path.resolve(packageDirectory, '../..');
const outputPath = path.join(packageDirectory, 'src/resources/generated/contracts.ts');
const check = process.argv.includes('--check');

const localContractDirectory = path.join(packageDirectory, 'contracts');
const workspaceContractDirectory = path.join(root, 'docs/architecture/invest-sdk/contracts');
const usesPublicProjection = await access(localContractDirectory)
  .then(() => true)
  .catch(() => false);
const contractDirectory = usesPublicProjection
  ? localContractDirectory
  : workspaceContractDirectory;

const sources = [
  {
    artifact: 'investment.openapi.yaml',
    definitions: (contract) => contract.components.schemas,
    roots: [
      ['InvestmentDetail', 'investmentDetailSchema'],
      ['InvestmentListResponse', 'investmentListResponseSchema'],
      ['ConfirmedInvestmentListResponse', 'confirmedInvestmentListResponseSchema'],
      ['OfferInvestmentProfileListResponse', 'offerInvestmentProfileListResponseSchema'],
      ['AmountStep', 'amountStepSchema'],
      ['SignatureStep', 'signatureStepSchema'],
      ['ReviewStepResponse', 'reviewStepResponseSchema'],
      ['EmptyResponse', 'emptyResponseSchema'],
      ['PositionResponse', 'positionResponseSchema'],
      ['RedemptionCommandResponse', 'redemptionCommandResponseSchema'],
      ['RedemptionResponse', 'redemptionResponseSchema'],
      ['RedemptionListResponse', 'redemptionListResponseSchema'],
    ],
  },
  {
    artifact: 'evm.swagger.yaml',
    definitions: (contract) => contract.definitions,
    roots: [
      ['ProfileWalletInfoResponse', 'profileWalletInfoResponseSchema'],
      ['WalletTransactionsResponse', 'walletTransactionsResponseSchema'],
      ['WalletAuthorizationSessionsResponse', 'walletAuthorizationSessionsResponseSchema'],
    ],
  },
  {
    artifact: 'offers.openapi.yaml',
    definitions: (contract) => contract.components.schemas,
    roots: [
      ['OfferListResponse', 'offerListResponseSchema'],
      ['OfferDetailResponse', 'offerDetailResponseSchema'],
    ],
  },
];

if (usesPublicProjection) {
  const provenance = JSON.parse(
    await readFile(path.join(contractDirectory, 'provenance.json'), 'utf8'),
  );
  if (provenance.schemaVersion !== 1 || !Array.isArray(provenance.sources)) {
    throw new Error('Public contract provenance is missing or malformed.');
  }
  for (const source of sources) {
    const recorded = provenance.sources.find((entry) => entry.file === source.artifact);
    const bytes = await readFile(path.join(contractDirectory, source.artifact));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (recorded?.publicProjectionSha256 !== actual) {
      throw new Error(`Public contract projection digest mismatch: ${source.artifact}`);
    }
  }
}

const referenceName = (reference) => reference.split('/').at(-1);

const collectDefinitions = (definitions, roots) => {
  const names = new Set();
  const visit = (name) => {
    if (names.has(name)) return;
    const schema = definitions[name];
    if (!schema) throw new Error(`Missing referenced schema: ${name}`);
    names.add(name);
    const references =
      JSON.stringify(schema).match(/#\/(?:definitions|components\/schemas)\/[A-Za-z0-9_]+/gu) ?? [];
    for (const reference of references) visit(referenceName(reference));
  };
  for (const [name] of roots) visit(name);
  return [...names];
};

const schemaType = (schema) => {
  let value;
  // A nullable enum may already carry null as one of its members, in which
  // case appending the nullable marker emits `null | … | null` and trips
  // @typescript-eslint/no-duplicate-type-constituents on the generated file.
  let alreadyNullable = false;
  if (schema.$ref) value = referenceName(schema.$ref);
  else if (Array.isArray(schema.allOf) && schema.allOf.length === 1)
    value = schemaType(schema.allOf[0]);
  else if (Array.isArray(schema.anyOf))
    value = [...new Set(schema.anyOf.map((option) => schemaType(option)))].join(' | ');
  else if (Array.isArray(schema.enum)) {
    const members = [...new Set(schema.enum.map(JSON.stringify))];
    alreadyNullable = members.includes('null');
    value = members.join(' | ');
  } else if (schema.type === 'array') value = `readonly (${schemaType(schema.items ?? {})})[]`;
  else if (schema.type === 'null') value = 'null';
  else if (schema.type === 'string') value = 'string';
  else if (schema.type === 'integer' || schema.type === 'number') value = 'number';
  else if (schema.type === 'boolean') value = 'boolean';
  else if (schema.type === 'object' && schema.properties) {
    const required = new Set(schema.required ?? []);
    value = `{ ${Object.entries(schema.properties)
      .map(
        ([property, propertySchema]) =>
          `readonly ${JSON.stringify(property)}${required.has(property) ? '' : '?'}: ${schemaType(propertySchema)}`,
      )
      .join('; ')} }`;
  } else if (schema.type === 'object' && schema.additionalProperties !== false) {
    value = 'Readonly<Record<string, unknown>>';
  } else if (schema.type === 'object') value = 'Readonly<Record<string, never>>';
  else value = 'unknown';
  return schema.nullable && !alreadyNullable ? `${value} | null` : value;
};

const renderInterface = (name, schema) => {
  if (schema.type !== 'object' || !schema.properties) {
    return `/** Generated from the pinned backend contract. @public */\nexport type ${name} = ${schemaType(schema)};`;
  }
  const required = new Set(schema.required ?? []);
  const properties = Object.entries(schema.properties).map(
    ([property, propertySchema]) =>
      `readonly ${JSON.stringify(property)}${required.has(property) ? '' : '?'}: ${schemaType(propertySchema)};`,
  );
  return `/** Generated from the pinned backend contract. @public */\nexport interface ${name} {\n${properties.join('\n')}\n}`;
};

const rewriteReferences = (value) => {
  if (Array.isArray(value)) return value.map(rewriteReferences);
  if (!value || typeof value !== 'object') return value;
  if (value.nullable === true) {
    const nonNullable = { ...value };
    delete nonNullable.nullable;
    return { anyOf: [rewriteReferences(nonNullable), { type: 'null' }] };
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('x-')) {
      continue;
    }
    if (key === '$ref') {
      result.$ref = `#/$defs/${referenceName(child)}`;
      continue;
    }
    result[key] = rewriteReferences(child);
  }
  return result;
};

const blocks = [
  '// This file is generated by scripts/generate-contract-resources.mjs.',
  '// Edit the pinned service contracts and regenerate; do not edit this file directly.',
];

for (const source of sources) {
  const contract = yaml.load(await readFile(path.join(contractDirectory, source.artifact), 'utf8'));
  const definitions = source.definitions(contract);
  const names = collectDefinitions(definitions, source.roots);
  for (const name of names) blocks.push(renderInterface(name, definitions[name]));
  for (const [rootName, constantName] of source.roots) {
    const schema = rewriteReferences(definitions[rootName]);
    schema.$defs = Object.fromEntries(
      names.map((name) => [name, rewriteReferences(definitions[name])]),
    );
    blocks.push(
      `/** Generated runtime schema for \`${rootName}\`. */\nexport const ${constantName} = ${JSON.stringify(schema, null, 2)} as const;`,
    );
  }
}

const prettierConfig = (await resolveConfig(outputPath)) ?? {};
const output = await format(`${blocks.join('\n\n')}\n`, {
  ...prettierConfig,
  parser: 'typescript',
});

if (check) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== output) {
    process.stderr.write('Generated SDK contract resources are stale. Run contracts:generate.\n');
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, output);
  process.stdout.write('Generated pinned SDK contract resource types and schemas.\n');
}
