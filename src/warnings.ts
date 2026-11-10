// Every warning goes through here, so `--strict` can tell whether a render raised any.

let count = 0;

export function warn(message: string): void {
  count++;
  console.error(`Warning: ${message}`);
}

export const warningCount = (): number => count;
