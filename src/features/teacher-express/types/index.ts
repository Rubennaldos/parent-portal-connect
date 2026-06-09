export type CreateTeacherExpressPayload = {
  full_name: string;
  dni: string;
  phone: string;
  school_id: string;
};

export type CreateTeacherExpressSuccess = {
  success: true;
  teacher_id: string;
  full_name: string;
  dni: string;
  phone_1: string;
  school_id: string;
  email: string;
};

export type TeacherExpressErrorCode =
  | 'ERR_TEACHER_UNAUTHORIZED'
  | 'ERR_TEACHER_INVALID_INPUT'
  | 'ERR_TEACHER_DUPLICATE_DNI'
  | 'ERR_TEACHER_SCHOOL_MISMATCH'
  | 'ERR_TEACHER_DATABASE';

export class TeacherExpressServiceError extends Error {
  code: TeacherExpressErrorCode;
  status: number;

  constructor(code: TeacherExpressErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
