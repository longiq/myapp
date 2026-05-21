from fastapi import APIRouter, Depends, Header, Request

from app.auth.dependencies import get_current_user
from app.models.user import User
from app.payment.schemas import (
    CardDetailsIn,
    ChargeCustomerIn,
    CustomerCreateIn,
    CustomerOut,
    FrontendPaymentIntentIn,
    PaymentConfirmIn,
    PaymentIntentCreateIn,
    PaymentOut,
    RefundIn,
    RefundOut,
)
from stripe_payment.customer import (
    attach_payment_method,
    create_customer,
    delete_customer,
    retrieve_customer,
)
from stripe_payment.models import Address, CardDetails, CustomerData
from stripe_payment.payment import (
    cancel_payment_intent,
    charge_customer,
    confirm_payment_intent,
    create_payment_intent,
    refund_payment,
    retrieve_payment_intent,
)
from stripe_payment.webhook import construct_webhook_event, handle_payment_intent_events

router = APIRouter(prefix="/payment", tags=["payment"])


def _customer_out(r) -> CustomerOut:
    return CustomerOut(
        customer_id=r.customer_id,
        email=r.email,
        name=r.name,
        payment_method_id=r.payment_method_id,
        metadata=r.metadata,
    )


def _payment_out(r) -> PaymentOut:
    return PaymentOut(
        payment_intent_id=r.payment_intent_id,
        status=r.status.value if hasattr(r.status, "value") else r.status,
        amount=r.amount,
        currency=r.currency,
        amount_display=r.amount_display,
        customer_id=r.customer_id,
        payment_method_id=r.payment_method_id,
        client_secret=r.client_secret,
        metadata=r.metadata,
    )


# ── Frontend endpoint (requires login) ────────────────────────────────────────


@router.post("/create-payment-intent")
def frontend_create_payment_intent(
    body: FrontendPaymentIntentIn,
    current_user: User = Depends(get_current_user),
):
    result = create_payment_intent(
        amount=body.amount,
        currency=body.currency,
        description=body.description or f"Payment by {current_user.username}",
        metadata={"user_id": str(current_user.id), "username": current_user.username},
    )
    return {"clientSecret": result.client_secret, "amount_display": result.amount_display}


# ── Customer management ────────────────────────────────────────────────────────


@router.post("/customers", response_model=CustomerOut, status_code=201)
def create_customer_endpoint(body: CustomerCreateIn):
    address = None
    if body.address:
        a = body.address
        address = Address(
            line1=a.line1,
            city=a.city,
            country=a.country,
            line2=a.line2,
            postal_code=a.postal_code,
            state=a.state,
        )
    return _customer_out(
        create_customer(
            CustomerData(
                email=body.email,
                name=body.name,
                phone=body.phone,
                address=address,
                metadata=body.metadata,
            )
        )
    )


@router.get("/customers/{customer_id}", response_model=CustomerOut)
def get_customer_endpoint(customer_id: str):
    return _customer_out(retrieve_customer(customer_id))


@router.delete("/customers/{customer_id}", status_code=204)
def delete_customer_endpoint(customer_id: str):
    delete_customer(customer_id)


@router.post("/customers/{customer_id}/payment-methods", response_model=CustomerOut)
def attach_pm_endpoint(customer_id: str, body: CardDetailsIn):
    card = CardDetails(
        number=body.number,
        exp_month=body.exp_month,
        exp_year=body.exp_year,
        cvc=body.cvc,
        name=body.name,
    )
    return _customer_out(attach_payment_method(customer_id, card))


# ── Payment intents ────────────────────────────────────────────────────────────


@router.post("/intents", response_model=PaymentOut, status_code=201)
def create_intent_endpoint(body: PaymentIntentCreateIn):
    return _payment_out(
        create_payment_intent(
            amount=body.amount,
            currency=body.currency,
            customer_id=body.customer_id,
            payment_method_id=body.payment_method_id,
            description=body.description,
            metadata=body.metadata,
            confirm=body.confirm,
        )
    )


@router.get("/intents/{intent_id}", response_model=PaymentOut)
def get_intent_endpoint(intent_id: str):
    return _payment_out(retrieve_payment_intent(intent_id))


@router.post("/intents/{intent_id}/confirm", response_model=PaymentOut)
def confirm_intent_endpoint(intent_id: str, body: PaymentConfirmIn):
    return _payment_out(confirm_payment_intent(intent_id, body.payment_method_id))


@router.post("/intents/{intent_id}/cancel", response_model=PaymentOut)
def cancel_intent_endpoint(intent_id: str):
    return _payment_out(cancel_payment_intent(intent_id))


@router.post("/charge", response_model=PaymentOut, status_code=201)
def charge_endpoint(body: ChargeCustomerIn):
    return _payment_out(
        charge_customer(
            customer_id=body.customer_id,
            payment_method_id=body.payment_method_id,
            amount=body.amount,
            currency=body.currency,
            description=body.description,
            metadata=body.metadata,
        )
    )


@router.post("/refunds", response_model=RefundOut, status_code=201)
def refund_endpoint(body: RefundIn):
    r = refund_payment(body.payment_intent_id, body.amount, body.reason)
    return RefundOut(
        refund_id=r.refund_id,
        payment_intent_id=r.payment_intent_id,
        amount=r.amount,
        currency=r.currency,
        status=r.status,
    )


# ── Webhook ────────────────────────────────────────────────────────────────────


@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(..., alias="stripe-signature"),
):
    payload = await request.body()
    event = construct_webhook_event(payload, stripe_signature)
    return {"received": True, "event": handle_payment_intent_events(event)}
