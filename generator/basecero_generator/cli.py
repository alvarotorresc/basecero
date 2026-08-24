import pathlib, sys
from .build_xlsx import build

def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "dist/BaseCero.xlsx")
    out.parent.mkdir(parents=True, exist_ok=True)
    build(str(out))
    print(f"Generado: {out}")

if __name__ == "__main__":
    main()
