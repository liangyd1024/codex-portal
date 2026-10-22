// Each RCM transport owns its tunnel's control socket. No user/global SSH
// configuration is changed and mutations keep their independent connection.
export function sshArgs(host, {reuse = false, master = false} = {}) {
  const socket = (reuse || master) && host.controlPath;
  return ['-S', socket || 'none', '-o', master ? 'ControlMaster=yes' : 'ControlMaster=no',
    '-o', 'ControlPersist=no', '-C', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-p', String(host.port), '-i', host.identityFile];
}
