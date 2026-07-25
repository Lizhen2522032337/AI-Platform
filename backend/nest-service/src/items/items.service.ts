import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { errorBody } from '../common/api-error.filter';
import { ItemPayloadDto } from './item.dto';
import { Item } from './item.entity';

@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(Item)
    private readonly repository: Repository<Item>,
  ) {}

  findAll(): Promise<Item[]> {
    return this.repository.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number): Promise<Item> {
    const item = await this.repository.findOneBy({ id });
    if (!item) {
      throw new NotFoundException(errorBody('NOT_FOUND', 'item not found'));
    }
    return item;
  }

  async create(payload: ItemPayloadDto): Promise<Item> {
    const item = this.repository.create(payload);
    return this.repository.save(item);
  }

  async update(id: number, payload: ItemPayloadDto): Promise<Item> {
    const item = await this.findOne(id);
    item.name = payload.name;
    item.description = payload.description;
    item.updatedAt = new Date();
    return this.repository.save(item);
  }

  async remove(id: number): Promise<void> {
    const result = await this.repository.delete(id);
    if (!result.affected) {
      throw new NotFoundException(errorBody('NOT_FOUND', 'item not found'));
    }
  }
}
