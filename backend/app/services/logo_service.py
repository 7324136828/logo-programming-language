"""Logo language validation, syntax checking, and sampler catalogue service."""

from __future__ import annotations

import re
from typing import Optional

from ..schemas.logo import LogoValidateResponse, SamplerItem

# Canonical list of authentic 1981 TI Logo samplers
SAMPLERS_CATALOGUE: list[SamplerItem] = [
    SamplerItem(
        id="a_colors",
        title="A_COLORS",
        description="Color mixing and palette laboratory",
        instructions="Choose two colors with R, B, or Y. Q ends the mixing activity.",
        has_graphics=True,
        preview_command="COLORS",
        starter_commands=["COLORS", "HELP"],
        tags=["Color", "Interactive", "1981"],
    ),
    SamplerItem(
        id="a_design",
        title="A_DESIGN",
        description="Grid patterns and keyboard-driven geometric designs",
        instructions="GRID accepts shape numbers 15–25. LISTEN moves the design with arrow keys; Q ends.",
        has_graphics=True,
        preview_command="GRID 20",
        starter_commands=["GRID 20", "LISTEN", "HELP"],
        tags=["Geometry", "Keyboard", "1981"],
    ),
    SamplerItem(
        id="a_elephant",
        title="A_ELEPHANT",
        description="Detailed multipart elephant that sprays animated water",
        instructions="Builds the elephant and continuously sprays water. Stop or Escape interrupts.",
        has_graphics=True,
        preview_command="ELEPHANT",
        starter_commands=["ELEPHANT", "HELP"],
        tags=["Animation", "Sprites", "1981"],
    ),
    SamplerItem(
        id="a_fish",
        title="A_FISH",
        description="Underwater ocean scene with swimming fish and rising bubbles",
        instructions="Swimming fish and bubbles continue until Stop or Escape.",
        has_graphics=True,
        preview_command="FISH",
        starter_commands=["FISH", "HELP"],
        tags=["Underwater", "Sprites", "1981"],
    ),
    SamplerItem(
        id="a_frog",
        title="A_FROG",
        description="Lily pond ecosystem with leaping frogs and flying insects",
        instructions="Frog, flies, and lily pads animate automatically. Stop or Escape interrupts; FREEZE pauses motion.",
        has_graphics=True,
        preview_command="FROG",
        starter_commands=["FROG", "POND", "HELP"],
        tags=["Ecosystem", "Autonomous", "1981"],
    ),
    SamplerItem(
        id="a_horse",
        title="A_HORSE",
        description="Carousel horse animation with multi-frame galloping sprites",
        instructions="Animated carousel continues until Stop or Escape.",
        has_graphics=True,
        preview_command="HORSE",
        starter_commands=["HORSE", "HELP"],
        tags=["Animation", "Movement", "1981"],
    ),
    SamplerItem(
        id="a_people",
        title="A_PEOPLE",
        description="Modular character builder with interactive body part styling",
        instructions="Arrow keys move a part; R/B/Y/W/O/G/P color it; A advances to next part; Q ends.",
        has_graphics=True,
        preview_command="PEOPLE",
        starter_commands=["PEOPLE", "HELP"],
        tags=["Character", "Interactive", "1981"],
    ),
    SamplerItem(
        id="a_spring",
        title="A_SPRING",
        description="Narrative springtime sequence with rain, sunrise, and blooming flowers",
        instructions="Rain, sunrise, and flower growth form a complete sequence. Stop or Escape interrupts.",
        has_graphics=True,
        preview_command="SPRING",
        starter_commands=["SPRING", "HELP"],
        tags=["Narrative", "Sequence", "1981"],
    ),
    SamplerItem(
        id="p_edsamp",
        title="P_EDSAMP",
        description="Educational sampler: turtle drawing lines, targets, and painting",
        instructions="LINE uses F/L/R for forward/left/right. PAINT adds B, P/N, S, and C. Q ends.",
        has_graphics=True,
        preview_command="LINE",
        starter_commands=["LINE", "PAINT", "TARGET", "HELP"],
        tags=["Tutorial", "Drawing", "1981"],
    ),
    SamplerItem(
        id="p_funsamp",
        title="P_FUNSAMP",
        description="Creative sampler: illustrations, teddy bear, patterns, and squares",
        instructions="PICTURE and BEAR finish a drawing. SQUARES and PATTERNS run continuously until Stop or Escape.",
        has_graphics=True,
        preview_command="PICTURE",
        starter_commands=["PICTURE", "BEAR", "SQUARES", "PATTERNS", "HELP"],
        tags=["Art", "Playground", "1981"],
    ),
]

STARTER_EXAMPLES: list[SamplerItem] = [
    SamplerItem(
        id="bloom",
        title="Orbital bloom",
        description="Small instructions. Unexpected possibilities.",
        instructions="Geometric petals rotated in an orbit, creating a complex floral mandala.",
        has_graphics=True,
        preview_command="REPEAT 18 [PETAL 1.1 RT 20]",
        starter_commands=["CS", "PETAL 1.1"],
        tags=["Geometry", "Mandala", "Starter"],
    ),
    SamplerItem(
        id="kinetic",
        title="Kinetic playground",
        description="Give your sprites a shape, a heading, and a little momentum.",
        instructions="Each sprite has a mind of its own. FREEZE pauses. THAW resumes.",
        has_graphics=True,
        preview_command="TELL [0 1 2 3 4 5]",
        starter_commands=["FREEZE", "THAW", "TELL 2 SS 1"],
        tags=["Sprites", "Physics", "Starter"],
    ),
    SamplerItem(
        id="tree",
        title="Recursive tree",
        description="A branching idea, made with a procedure that calls itself.",
        instructions="Nature has a fondness for recursion. Watch branches grow hierarchically.",
        has_graphics=True,
        preview_command="BRANCH 42 7",
        starter_commands=["BRANCH 42 7", "CS"],
        tags=["Recursion", "Fractal", "Starter"],
    ),
]


class LogoService:
    def list_samplers(self) -> list[SamplerItem]:
        return SAMPLERS_CATALOGUE

    def list_starters(self) -> list[SamplerItem]:
        return STARTER_EXAMPLES

    def get_sampler(self, sampler_id: str) -> Optional[SamplerItem]:
        lookup = {s.id.lower(): s for s in SAMPLERS_CATALOGUE + STARTER_EXAMPLES}
        return lookup.get(sampler_id.lower())

    def validate_logo_source(self, source: str) -> LogoValidateResponse:
        """Validate Logo source syntax, checking brackets, procedures, and structure."""
        errors: list[str] = []
        warnings: list[str] = []
        procedures: list[str] = []

        if not source.strip():
            return LogoValidateResponse(
                valid=True,
                errors=[],
                warnings=["Empty source code provided."],
                procedures=[],
                token_count=0,
            )

        # 1. Bracket and parenthesis balance check
        bracket_depth = 0
        paren_depth = 0
        in_comment = False
        tokens: list[str] = []

        lines = source.splitlines()
        current_procedure: Optional[str] = None
        procedure_start_line = 0

        for line_num, line in enumerate(lines, 1):
            stripped = line.strip()
            if not stripped or stripped.startswith(";"):
                continue

            # Tokenize line roughly
            line_tokens = re.findall(r';.*$|"[^\s\[\]()]+|:[\w.]+|\[|\]|\(|\)|[^\s\[\]()]+', line)

            for token in line_tokens:
                if token.startswith(";"):
                    break  # rest of line is comment
                tokens.append(token)
                upper = token.upper()

                if token == "[":
                    bracket_depth += 1
                elif token == "]":
                    bracket_depth -= 1
                    if bracket_depth < 0:
                        errors.append(f"Line {line_num}: Unexpected closing bracket ']' without matching '['.")
                        bracket_depth = 0
                elif token == "(":
                    paren_depth += 1
                elif token == ")":
                    paren_depth -= 1
                    if paren_depth < 0:
                        errors.append(f"Line {line_num}: Unexpected closing parenthesis ')' without matching '('.")
                        paren_depth = 0

            # Procedure checks (TO ... END)
            # Find TO at beginning of statements
            tokens_in_line = [t for t in line_tokens if not t.startswith(";")]
            i = 0
            while i < len(tokens_in_line):
                t_upper = tokens_in_line[i].upper()
                if t_upper == "TO":
                    if current_procedure is not None:
                        errors.append(
                            f"Line {line_num}: Nested procedure definition 'TO' inside '{current_procedure}' (started on line {procedure_start_line})."
                        )
                    elif i + 1 < len(tokens_in_line):
                        proc_name = tokens_in_line[i + 1].upper()
                        current_procedure = proc_name
                        procedure_start_line = line_num
                        procedures.append(proc_name)
                        i += 1
                    else:
                        errors.append(f"Line {line_num}: 'TO' requires a procedure name.")
                elif t_upper == "END":
                    if current_procedure is None:
                        warnings.append(f"Line {line_num}: 'END' found outside of any 'TO' definition.")
                    else:
                        current_procedure = None
                i += 1

        if bracket_depth > 0:
            errors.append(f"Unclosed square bracket: missing {bracket_depth} ']' bracket(s).")
        if paren_depth > 0:
            errors.append(f"Unclosed parenthesis: missing {paren_depth} ')' parenthesis(es).")
        if current_procedure is not None:
            errors.append(
                f"Unfinished procedure '{current_procedure}' starting on line {procedure_start_line}: missing 'END'."
            )

        is_valid = len(errors) == 0
        return LogoValidateResponse(
            valid=is_valid,
            errors=errors,
            warnings=warnings,
            procedures=procedures,
            token_count=len(tokens),
        )


logo_service = LogoService()
