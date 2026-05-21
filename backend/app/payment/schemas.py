from pydantic import BaseModel


class FrontendPaymentIntentIn(BaseModel):
    amount: int
    currency: str = "usd"
    description: str | None = None


class AddressIn(BaseModel):
    line1: str
    city: str
    country: str
    line2: str | None = None
    postal_code: str | None = None
    state: str | None = None


class CardDetailsIn(BaseModel):
    number: str
    exp_month: int
    exp_year: int
    cvc: str
    name: str | None = None


class CustomerCreateIn(BaseModel):
    email: str
    name: str | None = None
    phone: str | None = None
    address: AddressIn | None = None
    metadata: dict = {}


class PaymentIntentCreateIn(BaseModel):
    amount: int
    currency: str
    customer_id: str | None = None
    payment_method_id: str | None = None
    description: str | None = None
    metadata: dict | None = None
    confirm: bool = False


class PaymentConfirmIn(BaseModel):
    payment_method_id: str | None = None


class ChargeCustomerIn(BaseModel):
    customer_id: str
    payment_method_id: str
    amount: int
    currency: str
    description: str | None = None
    metadata: dict | None = None


class RefundIn(BaseModel):
    payment_intent_id: str
    amount: int | None = None
    reason: str | None = None


class CustomerOut(BaseModel):
    customer_id: str
    email: str
    name: str | None = None
    payment_method_id: str | None = None
    metadata: dict = {}


class PaymentOut(BaseModel):
    payment_intent_id: str
    status: str
    amount: int
    currency: str
    amount_display: str
    customer_id: str | None = None
    payment_method_id: str | None = None
    client_secret: str | None = None
    metadata: dict = {}


class RefundOut(BaseModel):
    refund_id: str
    payment_intent_id: str
    amount: int
    currency: str
    status: str
