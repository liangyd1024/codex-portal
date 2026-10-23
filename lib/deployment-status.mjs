// Web deployment does not inspect or control native turns.
export async function deploymentStatus(manager){return manager.status();}
