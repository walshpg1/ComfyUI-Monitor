'use strict';

const path = require('path');

const PIPELINE = 'D:\\AIStudio\\Pipeline';

const definitions = [
  {
    id: 'LTX_FFLF_Audio',
    label: 'LTX FFLF + Audio',
    estimatedTime: '~12–15 min',
    twoStage: false,
    stages: ['Generating'],
    inputs: ['avatar', 'audio', 'platform'],
    audioDir: path.join(PIPELINE, 'staging', 'audio_ready'),
    audioExtensions: ['wav'],
    avatarDir: path.join(PIPELINE, 'assets', 'avatars'),
    avatarExtensions: ['png', 'jpg', 'jpeg'],
  },
  {
    id: 'LTX_2Stage',
    label: 'LTX 2-Stage',
    estimatedTime: '~15–20 min',
    twoStage: true,
    stages: ['Generating', 'Upscaling'],
    inputs: ['avatar', 'audio', 'platform'],
    audioDir: path.join(PIPELINE, 'staging', 'audio_ready'),
    audioExtensions: ['wav'],
    avatarDir: path.join(PIPELINE, 'assets', 'avatars'),
    avatarExtensions: ['png', 'jpg', 'jpeg'],
  },
  {
    id: 'FLOAT',
    label: 'FLOAT',
    estimatedTime: '~10–12 min',
    twoStage: false,
    stages: ['Generating'],
    inputs: ['avatar', 'audio', 'platform'],
    audioDir: path.join(PIPELINE, 'staging', 'audio_ready'),
    audioExtensions: ['wav'],
    avatarDir: path.join(PIPELINE, 'assets', 'avatars'),
    avatarExtensions: ['png', 'jpg', 'jpeg'],
  },
];

function getById(id) {
  return definitions.find(d => d.id === id) || null;
}

module.exports = { definitions, getById };
