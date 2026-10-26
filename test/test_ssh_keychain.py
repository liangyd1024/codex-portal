import importlib.util
import pathlib
import unittest
from unittest.mock import MagicMock, patch
from io import StringIO

spec = importlib.util.spec_from_file_location('ssh_keychain', pathlib.Path(__file__).parents[1] / 'scripts/ssh-keychain.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class KeychainTest(unittest.TestCase):
    def test_os_status_survives_failed_read_and_save(self):
        for operation in ('read', 'save'):
            for status in (-25293, -25308, -25300):
                security = MagicMock()
                security.SecKeychainFindGenericPassword.return_value = status
                security.SecKeychainAddGenericPassword.return_value = status
                request = '{"operation":"%s","reference":"test","password":"fictional-secret"}' % operation
                with patch.object(module.C, 'CDLL', return_value=security), patch.object(module.sys, 'stdin', StringIO(request)):
                    with self.assertRaises(module.KeychainError) as caught:
                        module.main()
                self.assertEqual(module.error_result(caught.exception), {'error': 'KEYCHAIN_UNAVAILABLE', 'osStatus': status})
                security.SecKeychainSetUserInteractionAllowed.assert_called_once_with(False)

    def test_deleting_absent_item_remains_idempotent(self):
        security = MagicMock()
        security.SecKeychainFindGenericPassword.return_value = -25300
        with patch.object(module.C, 'CDLL', return_value=security), patch.object(module.sys, 'stdin', StringIO('{"operation":"delete","reference":"test"}')):
            self.assertEqual(module.main(), {'ok': True})

    def test_unexpected_errors_do_not_expose_exception_text(self):
        self.assertEqual(module.error_result(RuntimeError('fictional-secret')), {'error': 'KEYCHAIN_UNAVAILABLE'})
