// Bad relationship data is an author-visible header error, not a runtime crash.
export class HeaderDataError extends Error {
  constructor(kind,chain) {
    super(`Circular ${kind} chain: ${chain.join(' → ')}`);
    this.name='HeaderDataError';
    this.status=422;
    this.kind=kind;
    this.code=`circular-${kind}-chain`;
    this.chain=[...chain];
  }
}
