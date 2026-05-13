from fastapi import APIRouter, Depends
from app.auth.dependencies import get_current_user
from app.models.user import User

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("")
def list_inventory(current_user: User = Depends(get_current_user)):
    return {
        "message": "Inventory module - coming soon",
        "user": current_user.username,
        "items": [],
    }


@router.get("/stats")
def inventory_stats(current_user: User = Depends(get_current_user)):
    return {"total_items": 0, "low_stock": 0, "out_of_stock": 0}
