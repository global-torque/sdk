const PUBLISHABLE_ALPHA_CANDIDATE_VERSION = /^0\.(?:[1-9]\d*)\.0-alpha\.(?:0|[1-9]\d*)$/u;
const ORDINARY_RELEASE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export const isPublishableAlphaCandidateVersion = (value) =>
  typeof value === 'string' && PUBLISHABLE_ALPHA_CANDIDATE_VERSION.test(value);

export const isPublishableVersion = (value) =>
  typeof value === 'string' &&
  (ORDINARY_RELEASE_VERSION.test(value) || isPublishableAlphaCandidateVersion(value));

export const publishTagForVersion = (value) => {
  if (!isPublishableVersion(value)) {
    throw new Error(`Package version is not publishable semver: ${String(value)}`);
  }
  return isPublishableAlphaCandidateVersion(value) ? 'next' : 'latest';
};
