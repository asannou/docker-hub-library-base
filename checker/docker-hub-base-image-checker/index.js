#!/usr/bin/env node
'use strict';

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const DOCKER_AUTH_BASE_URL = 'https://auth.docker.io/';
const DOCKER_REGISTRY_SERVICE = 'registry.docker.io';
const DOCKER_REGISTRY_BASE_URL = 'https://registry-1.docker.io/v2/';

function slurpStream(stream) {
  return new Promise((resolve, reject) => {
    let buf = '';
    stream.on('data', (chunk) => buf += chunk);
    stream.on('end', () => resolve(buf));
  });
}

async function httpsGet(...args) {
  const res = await new Promise((resolve) => https.get(...args, resolve));
  return await slurpStream(res);
}

async function httpsPostJson(url, options, json) {
  const res = await new Promise((resolve) => {
    options = Object.assign(options, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const req = https.request(url, options, resolve);
    req.write(json);
    req.end();
  });
  return await slurpStream(res);
}

function sha256digest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

class DockerHubBaseImageChecker {

  constructor(base_image, image, trigger_url) {
    this.base_image = base_image;
    this.image = image;
    this.trigger_url = trigger_url;
    this.access_tokens = {};
  }

  async getAccessToken(scope) {
    if (!this.access_tokens[scope]) {
      const url = new URL('token', DOCKER_AUTH_BASE_URL);
      url.searchParams.set('scope', scope);
      url.searchParams.set('service', DOCKER_REGISTRY_SERVICE);
      const json = await httpsGet(url);
      this.access_tokens[scope] = JSON.parse(json).access_token;
    }
    return this.access_tokens[scope];
  }

  async getTags() {
    const scope = `repository:${this.image}:pull`;
    const access_token = await this.getAccessToken(scope);
    const url = new URL(`${this.image}/tags/list`, DOCKER_REGISTRY_BASE_URL);
    const headers = { Authorization: `Bearer ${access_token}` };
    const json = await httpsGet(url, { headers: headers });
    return JSON.parse(json).tags;
  }

  async getManifestsDigest(image, tag) {
    const scope = `repository:${image}:pull`;
    const access_token = await this.getAccessToken(scope);
    const url = new URL(`${image}/manifests/${tag}`, DOCKER_REGISTRY_BASE_URL);
    const headers = {
      Accept: 'application/vnd.docker.distribution.manifest.v2+json',
      Authorization: `Bearer ${access_token}`
    };
    const json = await httpsGet(url, { headers: headers });
    return sha256digest(json);
  }

  async pullBuildTrigger(tag) {
    const json = `{'docker_tag': '${tag}'}`;
    return await httpsPostJson(this.trigger_url, {}, json);
  }

  async checkManifestsDigest(tag) {
    const base_digest = await this.getManifestsDigest(this.base_image, tag);
    const digest = await this.getManifestsDigest(this.image, tag);
    if (base_digest != digest) {
      return this.pullBuildTrigger(tag);
    }
  }

  async checkAll() {
    const tags = await this.getTags();
    const checks = tags.map(tag => this.checkManifestsDigest(tag));
    return await Promise.all(checks);
  }

}

exports.handler = async (event, context, callback) => {
  const env_filter = (name) => name.startsWith('DOCKER_');
  const env_names = Object.keys(process.env).filter(env_filter);
  const checks = env_names.map((name) => {
    const args = process.env[name].split(' ');
    const checker = new DockerHubBaseImageChecker(...args);
    return checker.checkAll();
  });
  callback(null, await Promise.all(checks));
};

if (require.main === module) {
  exports.handler(undefined, undefined, console.log);
}

