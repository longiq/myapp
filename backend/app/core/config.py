from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "MyApp"
    SECRET_KEY: str = "CHANGE-THIS-SECRET-KEY-IN-PRODUCTION"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    DATABASE_URL: str = "sqlite:///./myapp.db"
    CORS_ORIGINS: list[str] = ["*"]
    STRIPE_SECRET_KEY: str = ""
    STRIPE_PUBLISHABLE_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_VERIFY_SSL: bool = True

    class Config:
        env_file = ".env"


settings = Settings()
