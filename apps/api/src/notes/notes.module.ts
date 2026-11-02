import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { NoteTaxCalculatorService } from './note-tax-calculator.service';

@Module({
  controllers: [NotesController],
  providers: [NotesService, NoteTaxCalculatorService],
})
export class NotesModule {}
