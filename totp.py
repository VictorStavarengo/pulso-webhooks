import io

import pyotp
import qrcode
import qrcode.image.svg

EMISSOR = "Pulso"


def gerar_segredo() -> str:
    return pyotp.random_base32()


def url_otpauth(email: str, segredo: str) -> str:
    return pyotp.TOTP(segredo).provisioning_uri(name=email, issuer_name=EMISSOR)


def qr_svg(url: str) -> str:
    imagem = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=8)
    buffer = io.BytesIO()
    imagem.save(buffer)
    return buffer.getvalue().decode("utf-8")


def verificar_codigo(segredo: str | None, codigo: str) -> bool:
    if not segredo:
        return False
    try:
        return pyotp.TOTP(segredo).verify(codigo.strip(), valid_window=1)
    except (ValueError, TypeError):
        return False
