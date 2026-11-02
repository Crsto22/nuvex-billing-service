import { Body, Controller, Get, Post } from '@nestjs/common';
import { RequireScopes } from '../auth/scope.decorator';
import { CalculationDto } from './dto/calculation.dto';
import { TaxCalculatorService } from './tax-calculator.service';

@Controller('calculations')
export class CalculationsController {
  constructor(private readonly calculator: TaxCalculatorService) {}

  @Get('policy')
  @RequireScopes('calculations:write')
  policy() {
    return this.calculator.getPolicy();
  }

  @Post()
  @RequireScopes('calculations:write')
  calculate(@Body() dto: CalculationDto) {
    return this.calculator.toResponse(this.calculator.calculate(dto));
  }
}
