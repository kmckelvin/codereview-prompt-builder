import { execFile } from 'node:child_process';

/**
 * Open a native directory picker and return the chosen absolute path, or
 * null if the user cancels. macOS only (osascript).
 */
export function pickDirectory(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return Promise.reject(new Error('The directory picker is only supported on macOS; type a path instead.'));
  }
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', 'POSIX path of (choose folder with prompt "Select a git repository")'],
      (err, stdout, stderr) => {
        if (err) {
          // exit code 1 with "User canceled" (-128) when the dialog is dismissed
          if (/-128|canceled/i.test(`${stderr}${err.message}`)) resolve(null);
          else reject(new Error(`osascript failed: ${stderr || err.message}`));
        } else {
          resolve(stdout.trim());
        }
      },
    );
  });
}
