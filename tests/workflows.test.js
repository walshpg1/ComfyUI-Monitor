const { definitions, getById } = require('../workflows/definitions');

const KNOWN_INPUTS = new Set(['avatar', 'audio', 'platform']);

test('exports a non-empty array of definitions', () => {
  expect(Array.isArray(definitions)).toBe(true);
  expect(definitions.length).toBeGreaterThan(0);
});

test('each definition has all required fields', () => {
  const required = [
    'id', 'label', 'estimatedTime', 'twoStage', 'stages', 'inputs',
    'audioDir', 'audioExtensions', 'avatarDir', 'avatarExtensions',
  ];
  for (const def of definitions) {
    for (const field of required) {
      expect(def).toHaveProperty(field);
    }
  }
});

test('no duplicate ids', () => {
  const ids = definitions.map(d => d.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('twoStage:true definitions have at least 2 stage labels', () => {
  for (const def of definitions) {
    if (def.twoStage) {
      expect(def.stages.length).toBeGreaterThanOrEqual(2);
    }
  }
});

test('all entries in inputs are known values', () => {
  for (const def of definitions) {
    for (const input of def.inputs) {
      expect(KNOWN_INPUTS.has(input)).toBe(true);
    }
  }
});

test('definitions with avatar input have avatarDir and avatarExtensions', () => {
  for (const def of definitions) {
    if (def.inputs.includes('avatar')) {
      expect(typeof def.avatarDir).toBe('string');
      expect(def.avatarDir.length).toBeGreaterThan(0);
      expect(Array.isArray(def.avatarExtensions)).toBe(true);
      expect(def.avatarExtensions.length).toBeGreaterThan(0);
    }
  }
});

test('definitions with audio input have audioDir and audioExtensions', () => {
  for (const def of definitions) {
    if (def.inputs.includes('audio')) {
      expect(typeof def.audioDir).toBe('string');
      expect(def.audioDir.length).toBeGreaterThan(0);
      expect(Array.isArray(def.audioExtensions)).toBe(true);
      expect(def.audioExtensions.length).toBeGreaterThan(0);
    }
  }
});

test('getById returns the matching definition object', () => {
  for (const def of definitions) {
    expect(getById(def.id)).toBe(def);
  }
});

test('getById returns null for an unknown id', () => {
  expect(getById('does-not-exist')).toBeNull();
});
