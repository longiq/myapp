import os
import stripe
from dotenv import load_dotenv
from .exceptions import ConfigurationError
from app.core.config import settings

load_dotenv()


def init_stripe(secret_key: str = None) -> None:
    key = secret_key or os.getenv("STRIPE_SECRET_KEY")
    if not key:
        raise ConfigurationError(
            "Stripe secret key is required. Pass it directly or set STRIPE_SECRET_KEY.",
            code="missing_api_key",
        )
    stripe.api_key = key
    # Local/dev fallback for corporate proxy SSL interception.
    if not settings.STRIPE_VERIFY_SSL:
        stripe.verify_ssl_certs = False


def get_stripe_client() -> stripe:
    if not stripe.api_key:
        raise ConfigurationError(
            "Stripe is not initialized. Call init_stripe() first.",
            code="not_initialized",
        )
    return stripe
