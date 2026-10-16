"""Host-side observation regressions; no browser or policy overrides required."""
import unittest
from unittest.mock import Mock, patch
from exporter_browser_wait import wait_for_export


class ExporterWaitTests(unittest.TestCase):
    def test_returns_observed_value_and_forwards_argument(self):
        page = Mock()
        page.evaluate.return_value = {'ready': True}
        self.assertEqual(wait_for_export(page, 'value => value.ready', arg={'ready': True}), {'ready': True})
        page.evaluate.assert_called_once_with('value => value.ready', {'ready': True})

    @patch('exporter_browser_wait.sleep')
    @patch('exporter_browser_wait.monotonic', side_effect=[0, 0.01, 0.02])
    def test_polls_until_async_observation_resolves_true(self, clock, sleep):
        page = Mock()
        # Playwright evaluate awaits a JS promise; false remains false, unlike
        # treating the pending Promise itself as a successful predicate.
        page.evaluate.side_effect = [False, False, True]
        self.assertTrue(wait_for_export(page, 'registration => registration.ready'))
        self.assertEqual(page.evaluate.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        page.wait_for_function.assert_not_called()

    @patch('exporter_browser_wait.sleep')
    @patch('exporter_browser_wait.monotonic', side_effect=[0, 25])
    def test_original_deadline_fails_closed(self, clock, sleep):
        page = Mock()
        page.evaluate.return_value = False
        with self.assertRaisesRegex(AssertionError, 'Exporter observation timed out'):
            wait_for_export(page, 'false')
        sleep.assert_not_called()
        self.assertEqual(page.evaluate.call_count, 1)

    def test_page_errors_are_not_retried_or_filtered(self):
        page = Mock()
        page.evaluate.side_effect = RuntimeError('CSP violation')
        with self.assertRaisesRegex(RuntimeError, 'CSP violation'):
            wait_for_export(page, 'false')
        self.assertEqual(page.evaluate.call_count, 1)

    def test_nonpositive_deadlines_do_not_disable_the_limit(self):
        page = Mock()
        for timeout in [0, -1]:
            with self.assertRaises(ValueError):
                wait_for_export(page, 'false', timeout=timeout)
        page.evaluate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
