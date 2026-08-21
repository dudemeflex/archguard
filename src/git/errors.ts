export class NotGitRepository extends Error {
  constructor(msg = 'Not a git repository') {
    super(msg);
    this.name = 'NotGitRepository';
  }
}

export class InvalidGitRef extends Error {
  constructor(ref: string) {
    super(`Unable to resolve Git ref: ${ref}`);
    this.name = 'InvalidGitRef';
  }
}

export class GitCommandFailure extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'GitCommandFailure';
  }
}
