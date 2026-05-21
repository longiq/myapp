from dataclasses import dataclass, field
from enum import Enum


class PaymentStatus(str, Enum):
    SUCCEEDED = "succeeded"
    PENDING = "pending"
    FAILED = "failed"
    CANCELED = "canceled"
    REQUIRES_ACTION = "requires_action"
    REQUIRES_CONFIRMATION = "requires_confirmation"
    REQUIRES_PAYMENT_METHOD = "requires_payment_method"
    REQUIRES_CAPTURE = "requires_capture"


class Currency(str, Enum):
    USD = "usd"
    EUR = "eur"
    GBP = "gbp"
    VND = "vnd"
    JPY = "jpy"
    SGD = "sgd"
    AUD = "aud"


@dataclass
class CardDetails:
    number: str
    exp_month: int
    exp_year: int
    cvc: str
    name: str | None = None


@dataclass
class Address:
    line1: str
    city: str
    country: str
    line2: str | None = None
    postal_code: str | None = None
    state: str | None = None


@dataclass
class CustomerData:
    email: str
    name: str | None = None
    phone: str | None = None
    address: Address | None = None
    metadata: dict = field(default_factory=dict)


@dataclass
class PaymentResult:
    payment_intent_id: str
    status: PaymentStatus
    amount: int
    currency: str
    customer_id: str | None = None
    payment_method_id: str | None = None
    client_secret: str | None = None
    receipt_url: str | None = None
    metadata: dict = field(default_factory=dict)

    @property
    def amount_display(self) -> str:
        if self.currency.lower() in ("jpy", "vnd"):
            return f"{self.amount} {self.currency.upper()}"
        return f"{self.amount / 100:.2f} {self.currency.upper()}"


@dataclass
class CustomerResult:
    customer_id: str
    email: str
    name: str | None = None
    payment_method_id: str | None = None
    metadata: dict = field(default_factory=dict)


@dataclass
class RefundResult:
    refund_id: str
    payment_intent_id: str
    amount: int
    currency: str
    status: str
