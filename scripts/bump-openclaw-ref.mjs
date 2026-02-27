import fs from "node:fs";

// Track releases from upstream openclaw, but our Dockerfile builds from PROPAGANDAnow/openclaw fork.
const upstreamOwner = "openclaw";
const upstreamRepo = "openclaw";
const forkOwner = "PROPAGANDAnow";
const forkRepo = "openclaw";
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Missing GITHUB_TOKEN");
  process.exit(2);
}

// PAT for fork operations (tag syncing) — falls back to GITHUB_TOKEN
const forkToken = process.env.FORK_PAT || token;

async function gh(path, opts = {}) {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      authorization: `Bearer ${opts.token || token}`,
      accept: "application/vnd.github+json",
      "user-agent": "clawdbot-railway-template-bot",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok && !(opts.allowFail && res.status === 422)) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function readCurrentTag(dockerfile) {
  const m = dockerfile.match(/\nARG OPENCLAW_GIT_REF=([^\n]+)\n/);
  return m ? m[1].trim() : null;
}

function replaceTag(dockerfile, next) {
  const re = /\nARG OPENCLAW_GIT_REF=([^\n]+)\n/;
  if (!re.test(dockerfile)) throw new Error("Could not find OPENCLAW_GIT_REF line");
  return dockerfile.replace(re, `\nARG OPENCLAW_GIT_REF=${next}\n`);
}

// Get latest upstream release
const latest = await gh(`/repos/${upstreamOwner}/${upstreamRepo}/releases/latest`);
const latestTag = latest.tag_name;
if (!latestTag) throw new Error("No tag_name in latest release response");

const dockerPath = "Dockerfile";
const docker = fs.readFileSync(dockerPath, "utf8");
const currentTag = readCurrentTag(docker);
if (!currentTag) throw new Error("Could not parse current OPENCLAW_GIT_REF");

console.log(`current=${currentTag} latest=${latestTag}`);

if (currentTag === latestTag) {
  console.log("No update needed.");
  process.exit(0);
}

// Sync the tag to PROPAGANDAnow/openclaw fork
console.log(`Syncing tag ${latestTag} to ${forkOwner}/${forkRepo}...`);
try {
  // Get the tag object SHA from upstream
  const tagRef = await gh(`/repos/${upstreamOwner}/${upstreamRepo}/git/ref/tags/${latestTag}`);
  const tagSha = tagRef.object.sha;

  // Create the same ref on the fork
  await gh(`/repos/${forkOwner}/${forkRepo}/git/refs`, {
    method: "POST",
    token: forkToken,
    body: { ref: `refs/tags/${latestTag}`, sha: tagSha },
    allowFail: true, // 422 = tag already exists, that's fine
  });
  console.log(`Tag ${latestTag} synced to fork.`);
} catch (err) {
  console.warn(`Warning: could not sync tag to fork: ${err.message}`);
  console.warn("The Railway build may fail if the tag doesn't exist on the fork.");
}

// Update the Dockerfile
fs.writeFileSync(dockerPath, replaceTag(docker, latestTag));
console.log(`Updated ${dockerPath} to ${latestTag}`);
