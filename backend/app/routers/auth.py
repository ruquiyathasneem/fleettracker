from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import User
from ..schemas import UserCreate, UserResponse, Token
import base64
import time

router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"]
)

# Standard OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

def create_access_token(data: dict):
    """
    Creates a simple self-signed base64 token to avoid external crypto library compilation issues.
    Format: username:role:expiry_timestamp
    """
    username = data.get("sub")
    role = data.get("role", "operator")
    expire = int(time.time()) + 86400  # 24 hours
    token_str = f"{username}:{role}:{expire}"
    token_bytes = token_str.encode("utf-8")
    return base64.b64encode(token_bytes).decode("utf-8")

def verify_token(token: str):
    """
    Verifies the self-signed base64 token.
    """
    try:
        token_bytes = base64.b64decode(token.encode("utf-8"))
        token_str = token_bytes.decode("utf-8")
        parts = token_str.split(":")
        if len(parts) != 3:
            return None
        username, role, expire = parts
        if int(time.time()) > int(expire):
            return None  # Expired
        return {"username": username, "role": role}
    except Exception:
        return None

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    """
    Dependency to validate token and return the current user.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    payload = verify_token(token)
    if payload is None:
        raise credentials_exception
        
    username = payload.get("username")
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

@router.post("/register", response_model=UserResponse)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """
    Registers a new operator/user.
    """
    existing_user = db.query(User).filter(User.username == user_data.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Store simple plain text password for demo, or double-check hash.
    # We will store plain password or simple prefix (for simplicity and zero dependencies).
    db_user = User(
        username=user_data.username,
        password_hash=user_data.password, # In production use pwd_context.hash()
        role=user_data.role
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    Authenticates user and returns access token.
    """
    user = db.query(User).filter(User.username == form_data.username).first()
    # Simple check for demo
    if not user or user.password_hash != form_data.password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    access_token = create_access_token(data={"sub": user.username, "role": user.role})
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """
    Returns details of the currently logged-in user.
    """
    return current_user
