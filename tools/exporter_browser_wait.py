"""Observe exporter state without the in-page eval used by wait_for_function.

Keep the application's CSP intact. Only the test host polls; page.evaluate uses
Playwright's normal protocol evaluation and awaits promise-valued observations.
Reference: microsoft/playwright#16357 and the Page.evaluate API documentation.
"""
from time import monotonic, sleep


def wait_for_export(page, expression, *, arg=None, timeout=25.0):
    if timeout <= 0:
        raise ValueError('Expected a positive observation timeout')
    deadline = monotonic() + timeout
    while True:
        # Do not swallow protocol, page, CSP or JavaScript errors as a timeout.
        result = page.evaluate(expression, arg)
        if result:
            return result
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise AssertionError('Exporter observation timed out: ' + expression)
        sleep(min(0.05, remaining))
