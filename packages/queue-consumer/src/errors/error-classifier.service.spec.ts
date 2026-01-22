import { Test, TestingModule } from '@nestjs/testing';
import { ErrorClassifierService } from './error-classifier.service';
import { ErrorCategory } from './relay-errors';

describe('ErrorClassifierService', () => {
  let service: ErrorClassifierService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ErrorClassifierService],
    }).compile();

    service = module.get<ErrorClassifierService>(ErrorClassifierService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Non-Retryable Error Patterns', () => {
    describe('Balance/Fund Errors', () => {
      it('should classify "insufficient funds" as NON_RETRYABLE', () => {
        const error = new Error('insufficient funds for gas * price + value');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('Insufficient balance for transaction');
      });

      it('should classify "insufficient balance" as NON_RETRYABLE', () => {
        const error = new Error('insufficient balance for transfer');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('Insufficient balance for transaction');
      });
    });

    describe('Gas Errors', () => {
      it('should classify "gas required exceeds allowance" as NON_RETRYABLE', () => {
        const error = new Error('gas required exceeds allowance (100000)');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('Gas limit exceeded allowance');
      });

      it('should classify "intrinsic gas too low" as NON_RETRYABLE', () => {
        const error = new Error('intrinsic gas too low');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('Insufficient gas provided');
      });

      it('should classify "out of gas" as NON_RETRYABLE', () => {
        const error = new Error('out of gas');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('Transaction ran out of gas');
      });
    });

    describe('Nonce Errors', () => {
      it('should classify "nonce too low" as NON_RETRYABLE', () => {
        const error = new Error('nonce too low: next nonce 5, got 3');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('Nonce already used');
      });

      it('should classify "nonce already used" as NON_RETRYABLE', () => {
        const error = new Error('nonce already used');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('Nonce already used');
      });
    });

    describe('Contract Execution Errors', () => {
      it('should classify "execution reverted" as NON_RETRYABLE', () => {
        const error = new Error('execution reverted: ERC20: transfer amount exceeds balance');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('Smart contract execution reverted');
      });

      it('should classify "transaction would revert" as NON_RETRYABLE', () => {
        const error = new Error('transaction would revert: insufficient allowance');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('Transaction simulation failed');
      });
    });

    describe('Non-Retryable HTTP Status Codes', () => {
      it('should classify HTTP 400 as NON_RETRYABLE', () => {
        const error = { message: 'Bad Request', status: 400 };
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('HTTP client error: 400');
        expect(result.httpStatus).toBe(400);
      });

      it('should classify HTTP 401 as NON_RETRYABLE', () => {
        const error = { message: 'Unauthorized', status: 401 };
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('HTTP client error: 401');
      });

      it('should classify HTTP 403 as NON_RETRYABLE', () => {
        const error = { message: 'Forbidden', status: 403 };
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('HTTP client error: 403');
      });

      it('should classify HTTP 422 as NON_RETRYABLE', () => {
        const error = { message: 'Unprocessable Entity', status: 422 };
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
        expect(result.reason).toBe('HTTP client error: 422');
      });
    });
  });

  describe('Retryable Error Patterns', () => {
    describe('Network Errors', () => {
      it('should classify "network timeout" as RETRYABLE', () => {
        const error = new Error('network timeout');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('Network timeout');
      });

      it('should classify "connection refused" as RETRYABLE', () => {
        const error = new Error('connection refused');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('Connection refused');
      });

      it('should classify ECONNREFUSED as RETRYABLE', () => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:8080');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('Connection refused (ECONNREFUSED)');
      });

      it('should classify ETIMEDOUT as RETRYABLE', () => {
        const error = new Error('connect ETIMEDOUT 10.0.0.1:443');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('Connection timed out (ETIMEDOUT)');
      });

      it('should classify ENOTFOUND as RETRYABLE', () => {
        const error = new Error('getaddrinfo ENOTFOUND api.example.com');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('DNS lookup failed (ENOTFOUND)');
      });

      it('should classify "socket hang up" as RETRYABLE', () => {
        const error = new Error('socket hang up');
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('Socket hang up');
      });
    });

    describe('Retryable HTTP Status Codes', () => {
      it('should classify HTTP 408 (Request Timeout) as RETRYABLE', () => {
        const error = { message: 'Request Timeout', status: 408 };
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('HTTP server error: 408');
        expect(result.httpStatus).toBe(408);
      });

      it('should classify HTTP 429 (Too Many Requests) as RETRYABLE', () => {
        const error = { message: 'Too Many Requests', status: 429 };
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('HTTP server error: 429');
      });

      it('should classify HTTP 500 (Internal Server Error) as RETRYABLE', () => {
        const error = { message: 'Internal Server Error', status: 500 };
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('HTTP server error: 500');
      });

      it('should classify HTTP 502 (Bad Gateway) as RETRYABLE', () => {
        const error = { message: 'Bad Gateway', status: 502 };
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('HTTP server error: 502');
      });

      it('should classify HTTP 503 (Service Unavailable) as RETRYABLE', () => {
        const error = { message: 'Service Unavailable', status: 503 };
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('HTTP server error: 503');
      });

      it('should classify HTTP 504 (Gateway Timeout) as RETRYABLE', () => {
        const error = { message: 'Gateway Timeout', status: 504 };
        const result = service.classify(error);

        expect(result.category).toBe(ErrorCategory.RETRYABLE);
        expect(result.reason).toBe('HTTP server error: 504');
      });
    });
  });

  describe('Default Behavior (Fail-safe)', () => {
    it('should classify unknown errors as RETRYABLE (fail-safe)', () => {
      const error = new Error('Some unknown error occurred');
      const result = service.classify(error);

      expect(result.category).toBe(ErrorCategory.RETRYABLE);
      expect(result.reason).toBe('Unknown error - defaulting to retryable (fail-safe)');
    });

    it('should classify empty error message as RETRYABLE', () => {
      const error = new Error('');
      const result = service.classify(error);

      expect(result.category).toBe(ErrorCategory.RETRYABLE);
    });
  });

  describe('Error Message Extraction', () => {
    it('should extract message from Error object', () => {
      const error = new Error('test error message');
      const result = service.classify(error);

      expect(result.originalMessage).toBe('test error message');
    });

    it('should handle string errors', () => {
      const error = 'string error message';
      const result = service.classify(error);

      expect(result.originalMessage).toBe('string error message');
    });

    it('should extract message from Axios-style error', () => {
      const error = {
        message: 'Request failed',
        response: {
          status: 500,
          data: {
            message: 'Internal server error from API',
          },
        },
      };
      const result = service.classify(error);

      expect(result.originalMessage).toBe('Internal server error from API');
      expect(result.httpStatus).toBe(500);
    });

    it('should extract error from Axios-style error with error field', () => {
      const error = {
        message: 'Request failed',
        response: {
          status: 400,
          data: {
            error: 'insufficient funds for gas',
          },
        },
      };
      const result = service.classify(error);

      expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
    });
  });

  describe('HTTP Status Code Extraction', () => {
    it('should extract status from direct status property', () => {
      const error = { message: 'Error', status: 500 };
      const result = service.classify(error);

      expect(result.httpStatus).toBe(500);
    });

    it('should extract status from statusCode property', () => {
      const error = { message: 'Error', statusCode: 503 };
      const result = service.classify(error);

      expect(result.httpStatus).toBe(503);
    });

    it('should extract status from response.status', () => {
      const error = { message: 'Error', response: { status: 502 } };
      const result = service.classify(error);

      expect(result.httpStatus).toBe(502);
    });

    it('should extract status from response.statusCode', () => {
      const error = { message: 'Error', response: { statusCode: 504 } };
      const result = service.classify(error);

      expect(result.httpStatus).toBe(504);
    });
  });

  describe('Helper Methods', () => {
    describe('isNonRetryable', () => {
      it('should return true for non-retryable errors', () => {
        const error = new Error('execution reverted');
        expect(service.isNonRetryable(error)).toBe(true);
      });

      it('should return false for retryable errors', () => {
        const error = new Error('network timeout');
        expect(service.isNonRetryable(error)).toBe(false);
      });
    });

    describe('isRetryable', () => {
      it('should return true for retryable errors', () => {
        const error = new Error('connection refused');
        expect(service.isRetryable(error)).toBe(true);
      });

      it('should return false for non-retryable errors', () => {
        const error = new Error('nonce too low');
        expect(service.isRetryable(error)).toBe(false);
      });
    });
  });

  describe('Pattern Priority', () => {
    it('should prioritize non-retryable patterns over retryable ones', () => {
      // If somehow an error message contains both patterns,
      // non-retryable should win (checked first)
      const error = new Error('execution reverted due to network timeout');
      const result = service.classify(error);

      expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
      expect(result.reason).toBe('Smart contract execution reverted');
    });

    it('should prioritize pattern match over HTTP status for non-retryable', () => {
      // Non-retryable pattern should be checked before HTTP status
      const error = {
        message: 'insufficient funds',
        status: 500, // This would normally be retryable
      };
      const result = service.classify(error);

      expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
      expect(result.reason).toBe('Insufficient balance for transaction');
    });
  });

  describe('Case Insensitivity', () => {
    it('should match patterns case-insensitively', () => {
      const errorLower = new Error('INSUFFICIENT FUNDS');
      const errorUpper = new Error('Insufficient Funds');
      const errorMixed = new Error('InSuFfIcIeNt FuNdS');

      expect(service.classify(errorLower).category).toBe(ErrorCategory.NON_RETRYABLE);
      expect(service.classify(errorUpper).category).toBe(ErrorCategory.NON_RETRYABLE);
      expect(service.classify(errorMixed).category).toBe(ErrorCategory.NON_RETRYABLE);
    });
  });
});
