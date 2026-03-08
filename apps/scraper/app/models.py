from pydantic import BaseModel


class CheckRequest(BaseModel):
    url: str
    css_selector: str | None = None


class CheckResponse(BaseModel):
    price: float | None = None
    stock_status: str | None = None  # "in_stock", "out_of_stock", or None
    raw_content: str | None = None
    error: str | None = None
