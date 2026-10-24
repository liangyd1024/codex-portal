import pathlib
import plistlib
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = (pathlib.Path(__file__).resolve().parents[1] / 'scripts/remote-service.py').read_text().split('\ntry:\n    main()')[0]

class AccountReloadTests(unittest.TestCase):
    def fixture(self, existing_marker=False, stop_fails=False):
        home = pathlib.Path(tempfile.mkdtemp(prefix='rcm-login-reload-'))
        root = home / '.codex/remote-codex-manager'
        root.mkdir(parents=True)
        binary = home / 'codex'; binary.write_text('native binary placeholder')
        if existing_marker: (root / 'maintenance.json').write_text('{"reason":"restore"}')
        env = {'SERVICE_HOME':str(home), 'SERVICE_USER':'preview', 'SERVICE_BINARY':str(binary), 'ACTION':'reload-login'}
        exec(SOURCE, env)
        calls = []; running = [True]
        def command(args):
            calls.append(args)
            if 'bootout' in args:
                if stop_fails: return types.SimpleNamespace(returncode=1, stdout='', stderr='stop rejected')
                running[0] = False
            if 'bootstrap' in args:
                running[0] = True; (root / 'app-server.sock').touch()
            rc = 0 if 'print' not in args or running[0] else 1
            return types.SimpleNamespace(returncode=rc, stdout='pid = 123\n' if 'print' in args else 'codex-cli test', stderr='')
        env.update(command=command, check_protocol=lambda *args:{}, ensure_relay=lambda:True, emit=lambda value:None)
        return home, root, env, calls

    def run_main(self, home, env):
        with patch.object(env['pwd'], 'getpwuid', return_value=types.SimpleNamespace(pw_name='preview')), patch.object(pathlib.Path, 'home', return_value=home):
            env['main']()

    def test_reload_preserves_maintenance_record_and_uses_native_binary(self):
        home, root, env, calls = self.fixture()
        self.run_main(home, env)
        self.assertEqual(sum('bootout' in c for c in calls), 1)
        self.assertEqual(sum('bootstrap' in c for c in calls), 1)
        self.assertFalse((root / 'maintenance.json').exists())
        self.assertEqual(len(list(root.glob('maintenance.login-reloaded-*.json'))), 1)

    def test_existing_maintenance_is_never_cleared(self):
        home, root, env, calls = self.fixture(existing_marker=True)
        with self.assertRaisesRegex(RuntimeError, '已有维护标记'): self.run_main(home, env)
        self.assertEqual(calls, [])
        self.assertIn('restore', (root / 'maintenance.json').read_text())

    def test_new_engine_has_descriptor_headroom_without_lowering_hard_limit(self):
        home, root, env, calls = self.fixture()
        self.run_main(home, env)
        config = plistlib.loads(env['JOB'].read_bytes())
        self.assertEqual(config['SoftResourceLimits']['NumberOfFiles'], 4096)
        self.assertNotIn('HardResourceLimits', config)
        self.assertEqual(config['ProgramArguments'][0], str(env['BINARY']))

    def test_ensure_does_not_restart_or_rewrite_running_engine(self):
        home, root, env, calls = self.fixture()
        env['ACTION'] = 'ensure'
        env['JOB'].parent.mkdir(parents=True)
        original = plistlib.dumps({'Label': env['LABEL']})
        env['JOB'].write_bytes(original)
        (root / 'app-server.sock').touch()
        self.run_main(home, env)
        self.assertEqual(env['JOB'].read_bytes(), original)
        self.assertFalse(any('bootout' in c or 'bootstrap' in c for c in calls))

    def test_failed_stop_keeps_marker_and_does_not_start_engine(self):
        home, root, env, calls = self.fixture(stop_fails=True)
        with self.assertRaisesRegex(RuntimeError, '停止专用服务失败'): self.run_main(home, env)
        self.assertTrue((root / 'maintenance.json').exists())
        self.assertFalse(any('bootstrap' in c for c in calls))
