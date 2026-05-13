class StripePaymentError(Exception):
    def __init__(self, message: str, code: str = None, stripe_error=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.stripe_error = stripe_error

    def __str__(self):
        return f"[{self.code}] {self.message}" if self.code else self.message


class CardDeclinedError(StripePaymentError):
    pass


class InvalidCardError(StripePaymentError):
    pass


class InsufficientFundsError(StripePaymentError):
    pass


class CustomerNotFoundError(StripePaymentError):
    pass


class PaymentIntentError(StripePaymentError):
    pass


class ConfigurationError(StripePaymentError):
    pass
