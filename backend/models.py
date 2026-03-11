import re
from pydantic import BaseModel, field_validator
from typing import Optional, List

from config import MIN_PASSWORD_LENGTH


def _validate_password(password: str) -> str:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Пароль должен быть не менее {MIN_PASSWORD_LENGTH} символов")
    if not re.search(r'[A-Za-zА-Яа-яЁё]', password):
        raise ValueError("Пароль должен содержать хотя бы одну букву")
    if not re.search(r'\d', password):
        raise ValueError("Пароль должен содержать хотя бы одну цифру")
    return password


class RegisterRequest(BaseModel):
    email: str
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        return _validate_password(v)


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v):
        return _validate_password(v)


class CheckEmailRequest(BaseModel):
    email: str


class AdminCreateUserRequest(BaseModel):
    email: str
    first_name: str
    last_name: str
    patronymic: Optional[str] = ""
    position: Optional[str] = ""


class AdminUpdateUserRequest(BaseModel):
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    patronymic: Optional[str] = None
    position: Optional[str] = None
    is_active: Optional[bool] = None


class CreateChatRequest(BaseModel):
    title: Optional[str] = "Новый чат"


class UpdateChatRequest(BaseModel):
    title: str


class FileMetadata(BaseModel):
    name: str
    size: int
    type: Optional[str] = None


class CreateMessageRequest(BaseModel):
    role: str
    content: str
    display_content: Optional[str] = None
    files: Optional[List[FileMetadata]] = None


class UpdateSettingsRequest(BaseModel):
    model: Optional[str] = None
    temperature: Optional[float] = None
    thinking: Optional[bool] = None
    num_ctx: Optional[int] = None


class MigrationChatMessage(BaseModel):
    role: str
    content: str
    displayContent: Optional[str] = None
    files: Optional[List[dict]] = None


class MigrationChat(BaseModel):
    id: str
    title: str
    messages: List[MigrationChatMessage]


class ImportChatsRequest(BaseModel):
    chats: List[MigrationChat]


class CreateFolderRequest(BaseModel):
    name: str
    parent_id: Optional[str] = None


class RenameFolderRequest(BaseModel):
    name: str


class MoveDocumentRequest(BaseModel):
    folder_id: Optional[str] = None


class CreateBackupRequest(BaseModel):
    note: Optional[str] = ""
